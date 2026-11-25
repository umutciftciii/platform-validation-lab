/**
 * ML-13b (DP-244): browser-side calls of the translation package routes (ML-13a) through the
 * admin's same-origin proxy: export (GET), dry run and import (POST, JSON up to 4 MB). Returns a
 * value instead of throwing, with a message in the console's language for every refusal the API
 * names (code and detail rule). Request paths, bodies and API codes are the contract's.
 */
import {
  ErrorBodySchema,
  TRANSLATION_PACKAGE_API,
  TranslationImportReportSchema,
  TranslationPackageSchema,
  type TranslationImportReport,
  type TranslationPackage,
  type TranslationPackageType,
} from "@dream/contracts";
import { browserAdminLocale } from "./i18n/config";
import { createTranslator } from "./i18n/translate";
import type { Translate } from "./i18n/types";
import { exportQuery, requestBody } from "./translation-packages";

const browserT = (): Translate => createTranslator(browserAdminLocale());

export type PackageAction = "export" | "dryRun" | "import";

export interface ApiIssue {
  path: string;
  rule: string;
}

export type PackageCall<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null; message: string; issues: ApiIssue[] };

/**
 * The browser gives up a little after the proxy (90 s for the import, 60 s otherwise), so a slow
 * API is reported by the proxy's 502 rather than by an aborted request.
 */
export const CLIENT_TIMEOUT_MS: Readonly<Record<PackageAction, number>> = {
  export: 75_000,
  dryRun: 75_000,
  import: 105_000,
};

/** The message for a refused or failed call, by action, HTTP status, API code and detail rules. */
export function packageErrorMessage(
  action: PackageAction,
  status: number,
  code: string | null,
  issues: readonly ApiIssue[],
  t: Translate = browserT(),
): string {
  const has = (path: RegExp | string, rule: string) =>
    issues.some(
      (i) => (typeof path === "string" ? i.path === path : path.test(i.path)) && i.rule === rule,
    );
  // i18n-ignore: a dictionary key prefix
  const k = "translationPackages.api" as const;
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return action === "import" ? t(`${k}.importNoAnswer`) : t(`${k}.unreachable`);
  }
  if (status === 403) return action === "import" ? t(`${k}.importForbidden`) : t(`${k}.forbidden`);
  if (status === 404) return t(`${k}.siteNotFound`);
  if (status === 413) return t(`${k}.tooLarge`);
  if (has(/^package\.units\.\d+\.(sourceHash|currentHash)$/, "mismatch")) {
    return t(`${k}.hashMismatch`);
  }
  if (has("package.site.key", "mismatch")) return t(`${k}.siteMismatch`);
  if (has("locale", "is_source")) return t(`${k}.isSource`);
  if (has("locale", "not_enabled")) return t(`${k}.notEnabled`);
  if (has("package.sourceLocale", "changed")) return t(`${k}.sourceChanged`);
  if (status === 409) return action === "import" ? t(`${k}.importStale`) : t(`${k}.conflict`);
  if (code === "VALIDATION_FAILED") {
    const paths = [...new Set(issues.map((i) => i.path))].slice(0, 5);
    return paths.length ? t(`${k}.invalidAt`, { paths: paths.join(", ") }) : t(`${k}.invalid`);
  }
  if (code === "RATE_LIMITED") return t("errors.RATE_LIMITED");
  if (code === "UNSUPPORTED_MEDIA_TYPE") return t("errors.UNSUPPORTED_MEDIA_TYPE");
  return t(`${k}.failed`);
}

async function call<T>(
  action: PackageAction,
  path: string,
  body: string | null,
  parse: (json: unknown) => T | null,
  fetchImpl: typeof fetch = fetch,
): Promise<PackageCall<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, {
      method: body === null ? "GET" : "POST",
      headers:
        body === null
          ? { Accept: "application/json" }
          : { "Content-Type": "application/json", Accept: "application/json" },
      ...(body === null ? {} : { body }),
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS[action]),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      code: null,
      message: packageErrorMessage(action, 0, null, []),
      issues: [],
    };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const data = parse(json);
    if (data !== null) return { ok: true, data };
    return {
      ok: false,
      status: res.status,
      code: null,
      message: packageErrorMessage(action, 500, null, []),
      issues: [],
    };
  }
  const parsed = ErrorBodySchema.safeParse(json);
  const code = parsed.success ? parsed.data.error.code : null;
  const issues = parsed.success
    ? parsed.data.error.details.filter(
        (d): d is ApiIssue => typeof d === "object" && d !== null && "path" in d && "rule" in d,
      )
    : [];
  return {
    ok: false,
    status: res.status,
    code,
    message: packageErrorMessage(action, res.status, code, issues),
    issues,
  };
}

const parsePackage = (json: unknown) => {
  const r = TranslationPackageSchema.safeParse(json);
  return r.success ? r.data : null;
};
const parseReport = (json: unknown) => {
  const r = TranslationImportReportSchema.safeParse(json);
  return r.success ? r.data : null;
};

export function exportPackage(
  siteId: string,
  locale: string,
  types: readonly TranslationPackageType[],
  fetchImpl?: typeof fetch,
): Promise<PackageCall<TranslationPackage>> {
  return call(
    "export",
    `${TRANSLATION_PACKAGE_API}/export${exportQuery(siteId, locale, types)}`,
    null,
    parsePackage,
    fetchImpl,
  );
}

/** Read only: nothing is written (ML-13a). */
export function dryRunPackage(
  pkg: TranslationPackage,
  fetchImpl?: typeof fetch,
): Promise<PackageCall<TranslationImportReport>> {
  return call(
    "dryRun",
    `${TRANSLATION_PACKAGE_API}/dry-run`,
    requestBody(pkg),
    parseReport,
    fetchImpl,
  );
}

/** Writes the valid units to drafts; publishes nothing (ML-13a). */
export function importPackage(
  pkg: TranslationPackage,
  fetchImpl?: typeof fetch,
): Promise<PackageCall<TranslationImportReport>> {
  return call(
    "import",
    `${TRANSLATION_PACKAGE_API}/import`,
    requestBody(pkg),
    parseReport,
    fetchImpl,
  );
}

/** Saves JSON as a file in the browser (an exported package, a report). No byte order mark. */
export function downloadJson(
  name: string,
  value: unknown,
  // i18n-ignore: a MIME type
  type = "application/json;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
