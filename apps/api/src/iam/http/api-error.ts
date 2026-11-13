/**
 * Error envelope of the authentication API (design 11.1, `@dream/contracts` errors.ts).
 * `ApiError` carries a contract code; the global filter turns every exception into
 * `{ error: { code, message, requestId, details } }`. Unknown errors become a generic 500 and are
 * logged by class name only, so no request data, secret or SQL text reaches the log or the client.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import {
  ERROR_STATUS,
  errorBody,
  type ErrorBody,
  type ErrorCode,
  validationDetails,
} from "@dream/contracts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { clearCookie } from "./cookies.js";
import type { RequestWithContext } from "./request-context.js";

type Details = ErrorBody["error"]["details"];

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly code: ErrorCode,
    readonly details: Details = [],
    readonly headers: Readonly<Record<string, string>> = {},
    /** Cookies to clear with the error response (e.g. an invalid session). */
    readonly clearCookies: readonly string[] = [],
  ) {
    super(code);
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

interface SafeParser<T> {
  safeParse(
    value: unknown,
  ):
    { success: true; data: T } | { success: false; error: Parameters<typeof validationDetails>[0] };
}

/** Validates a request body with a contract schema; 400 VALIDATION_FAILED names paths, not values. */
export function parseBody<T>(schema: SafeParser<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw new ApiError("VALIDATION_FAILED", validationDetails(result.error));
  return result.data;
}

/** Writes an error envelope directly (middleware, before Nest routing). */
export function writeError(
  res: ServerResponse,
  code: ErrorCode,
  requestId: string,
  details: Details = [],
  headers: Readonly<Record<string, string>> = {},
): void {
  const body = JSON.stringify(errorBody(code, requestId, details));
  res.statusCode = ERROR_STATUS[code];
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

const HTTP_STATUS_CODES: Readonly<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "AUTH_SESSION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiError");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage & RequestWithContext>();
    const res = http.getResponse<ServerResponse>();
    const requestId = req.dp?.requestId ?? "-";

    // Health endpoints keep Nest's own bodies (readiness returns its HealthResponse with 503).
    if (!req.dp && exception instanceof HttpException) {
      const body = exception.getResponse();
      res.statusCode = exception.getStatus();
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(typeof body === "string" ? { message: body } : body));
      return;
    }

    if (exception instanceof ApiError) {
      const headers = { ...exception.headers };
      if (exception.clearCookies.length) {
        res.setHeader("Set-Cookie", exception.clearCookies.map(clearCookie));
      }
      writeError(res, exception.code, requestId, exception.details, headers);
      return;
    }
    if (exception instanceof HttpException) {
      const code = HTTP_STATUS_CODES[exception.getStatus()] ?? "INTERNAL_ERROR";
      writeError(res, code, requestId);
      return;
    }
    this.logger.error(
      `unhandled ${(exception as Error)?.name ?? typeof exception} (request ${requestId})`,
    );
    writeError(res, "INTERNAL_ERROR", requestId);
  }
}
