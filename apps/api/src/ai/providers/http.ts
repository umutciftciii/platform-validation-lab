/**
 * DP-289: the HTTP layer of the provider adapters — deadline, size limit, JSON, one bounded retry
 * and the mapping of failures to result codes. `getJson` (list/retrieve endpoints, which cost
 * nothing) may retry once; `postJson` (DP-291 generation, a paid call) never retries.
 */
import { ProviderCallError } from "./types.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Largest provider response read (a model list is a few hundred kilobytes at most). */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** A Retry-After longer than this is not waited for: the call fails with rate_limited. */
export const MAX_RETRY_AFTER_SEC = 2;
const RETRY_BACKOFF_MS = 300;

export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

function retryAfterSec(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const s = Number(raw);
  if (Number.isFinite(s) && s >= 0) return Math.ceil(s);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function readJson(res: Response, limit = MAX_RESPONSE_BYTES): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new ProviderCallError("bad_response", res.status);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderCallError("bad_response", res.status);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ProviderCallError("bad_response", res.status);
  }
}

export interface ErrorFields {
  type: string;
  status: string;
  code: string;
  /** Google error details' `reason` values (e.g. API_KEY_INVALID). */
  reasons: string[];
}

/** The error body's type/status/code/reasons, for the adapters' mapping (never its message). */
export async function errorFields(res: Response): Promise<ErrorFields> {
  let body: unknown = null;
  try {
    body = await readJson(res);
  } catch {
    // An unreadable error body is mapped by status alone.
  }
  const err = (body as { error?: Record<string, unknown> } | null)?.error ?? {};
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const details = Array.isArray(err["details"]) ? (err["details"] as unknown[]) : [];
  const reasons = details
    .map((d) => (d && typeof d === "object" ? s((d as Record<string, unknown>)["reason"]) : ""))
    .filter(Boolean);
  return { type: s(err["type"]), status: s(err["status"]), code: s(err["code"]), reasons };
}

/** Status-only mapping shared by the adapters; they refine it with `errorFields`. */
export function codeForStatus(status: number): ProviderCallError["code"] {
  if (status === 401) return "credential_invalid";
  if (status === 403) return "permission_denied";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "provider_unavailable";
  return "bad_response";
}

export type ErrorMapper = (res: Response) => Promise<ProviderCallError>;

/**
 * One GET with a JSON answer. Retries once after a 429 with a short Retry-After, or after a 5xx
 * (529 included), when the deadline allows; never after a timeout of the deadline itself.
 */
export async function getJson(
  fetchImpl: FetchLike,
  req: ProviderRequest,
  mapError: ErrorMapper,
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(req.url, {
        method: "GET",
        headers: { accept: "application/json", ...req.headers },
        signal: req.signal,
        redirect: "error",
      });
    } catch (error) {
      if (req.signal.aborted) throw new ProviderCallError("timeout");
      if (error instanceof ProviderCallError) throw error;
      throw new ProviderCallError("network_error");
    }
    if (res.ok) return readJson(res);
    const failure = await mapError(res);
    const wait = failure.code === "rate_limited" ? failure.retryAfterSec : null;
    const retryable =
      attempt === 1 &&
      ((failure.code === "rate_limited" && wait !== null && wait <= MAX_RETRY_AFTER_SEC) ||
        failure.code === "provider_unavailable");
    if (!retryable || req.signal.aborted) throw failure;
    await new Promise((r) => setTimeout(r, wait !== null ? wait * 1000 : RETRY_BACKOFF_MS));
  }
}

/** Largest generation answer read (an AI-1/AI-2 answer is a few kilobytes). */
export const MAX_GENERATION_BYTES = 1024 * 1024;

/**
 * DP-291: one POST with a JSON body and a JSON answer — a paid generation call. NEVER retried:
 * after the request left, a timeout, a lost connection or an unreadable answer is uncertain (the
 * provider may have done and billed the work) and is thrown as `timeout` / `network_error` /
 * `bad_response`; an HTTP error answer is mapped by the adapter (the provider refused it).
 */
export async function postJson(
  fetchImpl: FetchLike,
  req: ProviderRequest & { body: unknown; onDispatch?: () => void },
  mapError: ErrorMapper,
): Promise<unknown> {
  let res: Response;
  try {
    const body = JSON.stringify(req.body);
    // DP-297: an aborted signal here means no request is sent at all.
    if (req.signal.aborted) throw new ProviderCallError("timeout");
    const pending = fetchImpl(req.url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...req.headers },
      body,
      signal: req.signal,
      redirect: "error",
    });
    // The request is with the transport now (same synchronous turn as the fetch call).
    req.onDispatch?.();
    res = await pending;
  } catch (error) {
    if (req.signal.aborted) throw new ProviderCallError("timeout");
    if (error instanceof ProviderCallError) throw error;
    throw new ProviderCallError("network_error");
  }
  if (!res.ok) throw await mapError(res);
  try {
    return await readJson(res, MAX_GENERATION_BYTES);
  } catch (error) {
    if (req.signal.aborted) throw new ProviderCallError("timeout");
    if (error instanceof ProviderCallError) throw error;
    throw new ProviderCallError("network_error");
  }
}

export { retryAfterSec };
