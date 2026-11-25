"use client";
/**
 * ML-13b (DP-244): Admin > Translations. One screen for the translation packages of ML-13a:
 *
 *  1. Export — site, source language (the site's default; fixed by the API), target language and
 *     parts (CMS / catalogue) → the package as a JSON file for the translators.
 *  2. Import — a translated package file → a dry run (read only, nothing written) → a filterable
 *     table of every unit (new, to update, unchanged, outdated, conflicting, invalid, …) → an
 *     explicit confirmation → the import, which writes the valid units to DRAFTS only (nothing is
 *     published, the target language is not opened to visitors) → the result with every skipped
 *     unit and its reason.
 *
 * The API decides every permission, unit and limit; this screen only shows what it may do (sites
 * and parts from the context routes, `canImport`/`missingPermissions` of the dry run).
 * Translation assistants (lib/translation-packages.ts `TranslationAssist`) would appear on the
 * loaded package; none is registered, so nothing renders for them.
 */
import type {
  TranslationImportReport,
  TranslationPackage,
  TranslationPackageType,
} from "@dream/contracts";
import {
  TRANSLATION_PACKAGE_MAX_BODY_BYTES,
  TRANSLATION_PACKAGE_MAX_UNITS,
} from "@dream/contracts";
import { useId, useMemo, useRef, useState } from "react";
import { dateTimeFormat, formatNumber } from "../../lib/i18n/format";
import { ADMIN_TIME_ZONE } from "../../lib/i18n/config";
import {
  downloadJson,
  dryRunPackage,
  exportPackage,
  importPackage,
} from "../../lib/translation-packages-client";
import {
  filterCount,
  filterLabel,
  filterRows,
  packageFileName,
  packageSummary,
  pageOf,
  readableTypes,
  readPackageFile,
  reportRows,
  ruleText,
  skippedCount,
  STATUS_FILTERS,
  STATUS_TONE,
  statusLabel,
  TRANSLATION_ASSISTS,
  withTargets,
  writableCount,
  type PackageFileProblem,
  type ReportRow,
  type StatusFilter,
  type TranslationAssist,
  type TranslationSite,
} from "../../lib/translation-packages";
import { FormMessage } from "../catalog/parts";
import { Dialog, DialogBody, DialogFooter } from "../dialog";
import { useAdminLocale, useT } from "../i18n/locale-provider";
import { Icon } from "../icons";
import { buttonStyles, cx, Spinner, StatusPill } from "../ui";

const FIELD =
  "h-10 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink disabled:bg-surface-2 disabled:text-ink-3";
const CARD = "space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5";

type Loaded = { fileName: string; pkg: TranslationPackage };
type Done = { report: TranslationImportReport; pkg: TranslationPackage };

export function TranslationWorkspace({
  sites,
  assists = TRANSLATION_ASSISTS,
}: {
  sites: readonly TranslationSite[];
  /** Extension point (none registered): proposals for the loaded package's targets. */
  assists?: readonly TranslationAssist[];
}) {
  const t = useT();
  const locale = useAdminLocale();
  return (
    <div className="space-y-6">
      <ExportPanel sites={sites} />
      <ImportPanel sites={sites} assists={assists} />
      <p className="text-xs text-ink-3">
        {t("translationPackages.limits", {
          mb: TRANSLATION_PACKAGE_MAX_BODY_BYTES / 1024 / 1024,
          units: formatNumber(TRANSLATION_PACKAGE_MAX_UNITS, locale),
        })}
      </p>
    </div>
  );
}

// --- export -----------------------------------------------------------------------------------

function ExportPanel({ sites }: { sites: readonly TranslationSite[] }) {
  const t = useT();
  const id = useId();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const [target, setTarget] = useState(site?.targets[0]?.locale ?? "");
  const [types, setTypes] = useState<TranslationPackageType[]>(site ? readableTypes(site) : []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!site) return null;
  const readable = readableTypes(site);
  const targetInfo = site.targets.find((l) => l.locale === target);
  const canExport = !pending && target !== "" && types.length > 0;

  function pickSite(next: string) {
    const s = sites.find((x) => x.id === next);
    if (!s) return;
    setSiteId(s.id);
    setTarget(s.targets[0]?.locale ?? "");
    setTypes(readableTypes(s));
    setError(null);
    setDone(null);
  }

  async function run() {
    if (!site || !canExport) return;
    setPending(true);
    setError(null);
    setDone(null);
    const res = await exportPackage(site.id, target, types);
    setPending(false);
    if (!res.ok) return setError(res.message);
    downloadJson(packageFileName(res.data), res.data);
    const s = packageSummary(res.data);
    setDone(t("translationPackages.export.done", { units: s.units, pages: s.pages }));
  }

  return (
    <section aria-labelledby={`${id}-title`} className={CARD}>
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold text-ink">
          {t("translationPackages.export.title")}
        </h2>
        <p className="text-sm text-ink-2">{t("translationPackages.export.intro")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1.5" htmlFor={`${id}-site`}>
          <span className="block text-sm font-medium text-ink">
            {t("translationPackages.export.site")}
          </span>
          <select
            id={`${id}-site`}
            className={FIELD}
            value={site.id}
            disabled={pending}
            onChange={(e) => pickSite(e.target.value)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5" htmlFor={`${id}-source`}>
          <span className="block text-sm font-medium text-ink">
            {t("translationPackages.export.source")}
          </span>
          <select
            id={`${id}-source`}
            className={FIELD}
            value={site.sourceLocale}
            disabled
            aria-describedby={`${id}-source-hint`}
          >
            <option value={site.sourceLocale}>{site.sourceLocale}</option>
          </select>
          <span id={`${id}-source-hint`} className="block text-xs text-ink-3">
            {t("translationPackages.export.sourceHint")}
          </span>
        </label>
        <label className="space-y-1.5" htmlFor={`${id}-target`}>
          <span className="block text-sm font-medium text-ink">
            {t("translationPackages.export.target")}
          </span>
          <select
            id={`${id}-target`}
            className={FIELD}
            value={target}
            disabled={pending || site.targets.length === 0}
            aria-describedby={`${id}-target-hint`}
            onChange={(e) => {
              setTarget(e.target.value);
              setDone(null);
            }}
          >
            {site.targets.map((l) => (
              <option key={l.locale} value={l.locale}>
                {l.public
                  ? l.locale
                  : t("translationPackages.export.notPublicOption", { locale: l.locale })}
              </option>
            ))}
          </select>
          <span id={`${id}-target-hint`} className="block text-xs text-ink-3">
            {site.targets.length === 0
              ? t("translationPackages.export.noTargets")
              : targetInfo && !targetInfo.public
                ? t("translationPackages.export.notPublicHint", { locale: targetInfo.locale })
                : t("translationPackages.export.targetHint")}
          </span>
        </label>
      </div>
      <fieldset className="space-y-2" disabled={pending}>
        <legend className="text-sm font-medium text-ink">
          {t("translationPackages.export.types")}
        </legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(["cms", "catalog"] as const).map((type) => (
            <label key={type} className="flex items-start gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={types.includes(type)}
                disabled={!readable.includes(type)}
                onChange={(e) =>
                  setTypes((prev) =>
                    e.target.checked
                      ? (["cms", "catalog"] as const).filter((x) => x === type || prev.includes(x))
                      : prev.filter((x) => x !== type),
                  )
                }
              />
              <span>
                <span className="block font-medium text-ink">
                  {t(`translationPackages.types.${type}`)}
                </span>
                <span className="block text-xs text-ink-3">
                  {readable.includes(type)
                    ? t(`translationPackages.types.${type}Hint`)
                    : t("translationPackages.types.noRead")}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={!canExport}
          aria-busy={pending}
          onClick={() => void run()}
        >
          {pending ? (
            <Spinner key="busy" size={14} />
          ) : (
            <Icon key="idle" name="download" size={16} />
          )}
          <span>
            {pending
              ? t("translationPackages.export.running")
              : t("translationPackages.export.run")}
          </span>
        </button>
        {types.length === 0 && readable.length > 0 ? (
          <span className="text-xs text-ink-3">{t("translationPackages.export.pickType")}</span>
        ) : null}
      </div>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {done ? <FormMessage kind="success">{done}</FormMessage> : null}
    </section>
  );
}

// --- import -----------------------------------------------------------------------------------

function ImportPanel({
  sites,
  assists,
}: {
  sites: readonly TranslationSite[];
  assists: readonly TranslationAssist[];
}) {
  const t = useT();
  const locale = useAdminLocale();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<TranslationImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  function reset() {
    setLoaded(null);
    setReport(null);
    setError(null);
    setDone(null);
    setFileError(null);
    setImportError(null);
  }

  async function pick(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > TRANSLATION_PACKAGE_MAX_BODY_BYTES) {
      return setFileError(fileProblem("too_large", [], t));
    }
    setReading(true);
    const read = readPackageFile(await file.text(), file.size);
    setReading(false);
    if (!read.ok) return setFileError(fileProblem(read.problem, read.paths, t));
    setLoaded({ fileName: file.name, pkg: read.pkg });
  }

  async function check() {
    if (!loaded) return;
    setChecking(true);
    setError(null);
    setReport(null);
    setDone(null);
    const res = await dryRunPackage(loaded.pkg);
    setChecking(false);
    if (!res.ok) return setError(res.message);
    setReport(res.data);
  }

  /** An assistant fills targets; the result goes through the same dry run and confirmation. */
  async function assist(a: TranslationAssist) {
    if (!loaded) return;
    setReport(null);
    setDone(null);
    setError(null);
    setChecking(true);
    try {
      const proposals = await a.propose(loaded.pkg.units, loaded.pkg);
      setLoaded({ ...loaded, pkg: withTargets(loaded.pkg, proposals) });
    } catch {
      setError(t("translationPackages.import.assistFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function runImport() {
    if (!loaded || !report) return;
    setImporting(true);
    setImportError(null);
    const res = await importPackage(loaded.pkg);
    setImporting(false);
    if (!res.ok) return setImportError(res.message);
    setConfirming(false);
    setReport(null);
    setDone({ report: res.data, pkg: loaded.pkg });
  }

  const summary = loaded ? packageSummary(loaded.pkg) : null;
  const site = loaded ? sites.find((s) => s.id === loaded.pkg.site.id) : undefined;
  const busy = reading || checking || importing;

  return (
    <section aria-labelledby={`${id}-title`} className={CARD}>
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-semibold text-ink">
          {t("translationPackages.import.title")}
        </h2>
        <p className="text-sm text-ink-2">{t("translationPackages.import.intro")}</p>
      </div>
      <label className="block space-y-1.5" htmlFor={`${id}-file`}>
        <span className="block text-sm font-medium text-ink">
          {t("translationPackages.import.file", {
            mb: TRANSLATION_PACKAGE_MAX_BODY_BYTES / 1024 / 1024,
          })}
        </span>
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
          className="block w-full min-w-0 text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
      </label>
      {reading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-3">
          <Spinner size={14} />
          <span>{t("translationPackages.import.reading")}</span>
        </p>
      ) : null}
      {fileError ? <FormMessage kind="error">{fileError}</FormMessage> : null}

      {loaded && summary ? (
        <div className="space-y-3">
          <dl
            aria-label={t("translationPackages.import.packageLabel")}
            className="grid gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-4 py-3 text-sm ring-1 ring-inset ring-line sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="min-w-0">
              <dt className="text-xs text-ink-3">{t("translationPackages.import.fileName")}</dt>
              <dd className="truncate text-ink" title={loaded.fileName}>
                {loaded.fileName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">
                {t("translationPackages.import.siteAndLanguages")}
              </dt>
              <dd className="text-ink">
                {`${site?.name ?? loaded.pkg.site.key} · ${loaded.pkg.sourceLocale} → ${loaded.pkg.targetLocale}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">{t("translationPackages.import.contents")}</dt>
              <dd className="text-ink">
                {`${loaded.pkg.types.map((x) => t(`translationPackages.types.${x}`)).join(", ")} · ${t("translationPackages.import.unitCount", { count: summary.units })} · ${t("translationPackages.import.filledCount", { count: summary.filled })}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">{t("translationPackages.import.exportedAt")}</dt>
              <dd className="text-ink">
                {dateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: ADMIN_TIME_ZONE,
                }).format(new Date(loaded.pkg.exportedAt))}
              </dd>
            </div>
          </dl>
          {!site ? (
            <p className="text-sm text-amber-ink">{t("translationPackages.import.otherSite")}</p>
          ) : null}
          {summary.filled === 0 ? (
            <p className="text-sm text-ink-3">{t("translationPackages.import.nothingFilled")}</p>
          ) : null}
          {assists.length ? (
            <div
              role="group"
              aria-label={t("translationPackages.import.assists")}
              className="flex flex-wrap gap-2"
            >
              {assists.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={buttonStyles.secondary}
                  disabled={busy}
                  onClick={() => void assist(a)}
                >
                  {t(a.label)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={buttonStyles.secondary}
              disabled={busy}
              aria-busy={checking}
              onClick={() => void check()}
            >
              {checking ? (
                <Spinner key="busy" size={14} />
              ) : (
                <Icon key="idle" name="check" size={16} />
              )}
              <span>
                {checking
                  ? t("translationPackages.import.checking")
                  : t("translationPackages.import.check")}
              </span>
            </button>
            <span className="text-xs text-ink-3">{t("translationPackages.import.checkHint")}</span>
          </div>
        </div>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      {loaded && report ? (
        <ReportView
          key={`check-${report.digest}`}
          mode="check"
          pkg={loaded.pkg}
          report={report}
          onImport={() => {
            setImportError(null);
            setConfirming(true);
          }}
          busy={busy}
        />
      ) : null}

      {done ? (
        <ReportView
          key={`done-${done.report.digest}`}
          mode="done"
          pkg={done.pkg}
          report={done.report}
          busy={busy}
          onAgain={() => {
            reset();
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
      ) : null}

      {confirming && report && loaded ? (
        <ConfirmImport
          report={report}
          pkg={loaded.pkg}
          pending={importing}
          error={importError}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void runImport()}
        />
      ) : null}
    </section>
  );
}

function fileProblem(
  problem: PackageFileProblem,
  paths: readonly string[],
  t: ReturnType<typeof useT>,
) {
  if (problem === "too_large") {
    return t("translationPackages.file.too_large", {
      mb: TRANSLATION_PACKAGE_MAX_BODY_BYTES / 1024 / 1024,
    });
  }
  if (problem === "schema" && paths.length) {
    return t("translationPackages.file.schemaAt", { paths: paths.join(", ") });
  }
  return t(`translationPackages.file.${problem}`);
}

// --- report (dry run and result) --------------------------------------------------------------

function ReportView({
  mode,
  pkg,
  report,
  busy,
  onImport,
  onAgain,
}: {
  mode: "check" | "done";
  pkg: TranslationPackage;
  report: TranslationImportReport;
  busy: boolean;
  onImport?: () => void;
  onAgain?: () => void;
}) {
  const t = useT();
  const id = useId();
  const rows = useMemo(() => reportRows(pkg, report), [pkg, report]);
  const skipped = skippedCount(report);
  const [filter, setFilter] = useState<StatusFilter>(
    mode === "done" && skipped > 0 ? "skipped" : "all",
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const shown = useMemo(() => filterRows(rows, filter, query), [rows, filter, query]);
  const view = pageOf(shown, page);
  const writable = writableCount(report);
  const w = report.written;
  const written =
    w.cmsPagesCreated + w.cmsPagesUpdated + w.listings + w.categories + w.specs + w.images;

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
          {mode === "check"
            ? t("translationPackages.report.checkTitle")
            : t("translationPackages.report.doneTitle")}
        </h3>
        <p role="status" className="text-sm text-ink-2">
          {mode === "check"
            ? t("translationPackages.report.checkSummary", {
                writable,
                skipped,
                total: report.units.length,
              })
            : t("translationPackages.report.doneSummary", { written, skipped })}
        </p>
      </div>

      {mode === "done" ? (
        <dl
          className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6"
          aria-label={t("translationPackages.report.writtenLabel")}
        >
          {(
            [
              ["cmsPagesCreated", w.cmsPagesCreated],
              ["cmsPagesUpdated", w.cmsPagesUpdated],
              ["listings", w.listings],
              ["categories", w.categories],
              ["specs", w.specs],
              ["images", w.images],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-inset ring-line">
              <dt className="text-xs text-ink-3">{t(`translationPackages.written.${k}`)}</dt>
              <dd className="text-base font-semibold text-ink">{n}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {mode === "check" && !report.canImport ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink ring-1 ring-inset ring-amber/25"
        >
          <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("translationPackages.report.missingPermissions", {
              permissions: report.missingPermissions.join(", "),
            })}
          </span>
        </p>
      ) : null}

      <div
        role="group"
        aria-label={t("translationPackages.report.filterLabel")}
        className="flex flex-wrap gap-2"
      >
        {STATUS_FILTERS.map((f) => {
          const n = filterCount(report, f);
          const current = filter === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={current}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              className={cx(
                "rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                current
                  ? "bg-petrol-soft text-petrol-strong ring-petrol/30"
                  : "bg-surface-2 text-ink-2 ring-line hover:text-ink",
              )}
            >
              {t("translationPackages.report.filterChip", { label: filterLabel(f, t), n })}
            </button>
          );
        })}
      </div>
      <label className="block max-w-md space-y-1" htmlFor={`${id}-q`}>
        <span className="block text-xs font-medium text-ink-3">
          {t("translationPackages.report.search")}
        </span>
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          maxLength={200}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className={FIELD}
        />
      </label>

      <UnitTable
        rows={view.rows}
        labelledBy={`${id}-title`}
        sourceLocale={pkg.sourceLocale}
        targetLocale={pkg.targetLocale}
      />
      {shown.length === 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-sm text-ink-3 ring-1 ring-inset ring-line">
          {rows.length === 0
            ? t("translationPackages.report.noUnits")
            : t("translationPackages.report.noMatch")}
        </p>
      ) : null}
      {view.pages > 1 ? (
        <nav
          aria-label={t("translationPackages.report.pages")}
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={view.page <= 1}
            onClick={() => setPage(view.page - 1)}
          >
            {t("translationPackages.report.previous")}
          </button>
          <span className="text-sm text-ink-3">
            {t("translationPackages.report.pageOf", {
              page: view.page,
              pages: view.pages,
              count: shown.length,
            })}
          </span>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={view.page >= view.pages}
            onClick={() => setPage(view.page + 1)}
          >
            {t("translationPackages.report.next")}
          </button>
        </nav>
      ) : null}

      {report.pages.length ? <PageResults pkg={pkg} report={report} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        {mode === "check" ? (
          <button
            key="import"
            type="button"
            className={buttonStyles.primary}
            disabled={busy || !report.canImport || writable === 0}
            onClick={onImport}
          >
            <Icon name="upload" size={16} />
            <span>{t("translationPackages.report.import", { count: writable })}</span>
          </button>
        ) : (
          <button
            key="again"
            type="button"
            className={buttonStyles.secondary}
            disabled={busy}
            onClick={onAgain}
          >
            <Icon name="refresh" size={16} />
            <span>{t("translationPackages.report.another")}</span>
          </button>
        )}
        <button
          type="button"
          className={buttonStyles.ghost}
          onClick={() =>
            downloadJson(
              `translation-${mode === "check" ? "check" : "import"}-report-${report.digest.slice(0, 12)}.json`,
              report,
            )
          }
        >
          <Icon name="download" size={16} />
          <span>{t("translationPackages.report.download")}</span>
        </button>
        <span className="text-xs text-ink-3">
          {mode === "done"
            ? t("translationPackages.report.doneNote")
            : !report.canImport
              ? t("translationPackages.report.cannotImport")
              : writable === 0
                ? t("translationPackages.report.nothingToImport")
                : t("translationPackages.report.draftOnly")}
        </span>
      </div>
    </div>
  );
}

function UnitTable({
  rows,
  labelledBy,
  sourceLocale,
  targetLocale,
}: {
  rows: readonly ReportRow[];
  labelledBy: string;
  /** Data texts carry their language (screen readers, DataInText pattern of DP-275). */
  sourceLocale: string;
  targetLocale: string;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-line">
      <table aria-labelledby={labelledBy} className="w-full min-w-[48rem] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("translationPackages.table.status")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("translationPackages.table.text")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("translationPackages.table.source")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("translationPackages.table.translation")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("translationPackages.table.reason")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.key} className="align-top">
              <td className="px-3 py-2">
                <StatusPill tone={STATUS_TONE[r.status]}>{statusLabel(r.status, t)}</StatusPill>
              </td>
              <td className="max-w-[16rem] px-3 py-2">
                <span className="block break-words text-ink">{r.context || "—"}</span>
                <span className="block break-all font-mono text-xs text-ink-3">
                  {r.kind ? `${r.kind} · ${r.field}` : r.key}
                </span>
              </td>
              <td className="max-w-[18rem] px-3 py-2">
                <span
                  lang={sourceLocale}
                  className="line-clamp-4 whitespace-pre-wrap break-words text-ink-2"
                >
                  {r.source ?? "—"}
                </span>
              </td>
              <td className="max-w-[18rem] px-3 py-2">
                <span
                  lang={r.target?.trim() ? targetLocale : undefined}
                  className="line-clamp-4 whitespace-pre-wrap break-words text-ink"
                >
                  {r.target?.trim() ? r.target : "—"}
                </span>
                {r.current !== null && (r.status === "update" || r.status === "conflict") ? (
                  <span className="mt-1 block text-xs text-ink-3">
                    {t("translationPackages.table.current", {
                      text: r.current.length > 120 ? `${r.current.slice(0, 120)}…` : r.current,
                    })}
                  </span>
                ) : null}
              </td>
              <td className="max-w-[14rem] px-3 py-2 text-xs text-ink-2">
                <span>{ruleText(r.rule, t) ?? "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageResults({
  pkg,
  report,
}: {
  pkg: TranslationPackage;
  report: TranslationImportReport;
}) {
  const t = useT();
  const paths = new Map(pkg.pages.map((p) => [p.groupId, p.path]));
  return (
    <details className="rounded-lg ring-1 ring-inset ring-line">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
        {t("translationPackages.pages.summary", { count: report.pages.length })}
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {report.pages.map((p) => (
          <li key={p.groupId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <StatusPill
              tone={
                p.action === "skipped" ? "amber" : p.action === "unchanged" ? "neutral" : "petrol"
              }
            >
              {t(`translationPackages.pages.${p.action}`)}
            </StatusPill>
            <span className="break-all font-mono text-xs text-ink">
              {paths.get(p.groupId) ?? t("translationPackages.pages.fragment")}
            </span>
            {p.rule ? <span className="text-xs text-ink-3">{ruleText(p.rule, t)}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

// --- confirmation -----------------------------------------------------------------------------

function ConfirmImport({
  report,
  pkg,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  report: TranslationImportReport;
  pkg: TranslationPackage;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const id = useId();
  const [ack, setAck] = useState(false);
  const writable = writableCount(report);
  return (
    <Dialog
      role="alertdialog"
      size="md"
      title={t("translationPackages.confirm.title")}
      description={
        <p>
          {t("translationPackages.confirm.text", {
            count: writable,
            skipped: skippedCount(report),
            locale: pkg.targetLocale,
          })}
        </p>
      }
      busy={pending}
      onClose={onCancel}
    >
      <DialogBody>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>{t("translationPackages.confirm.drafts")}</li>
          <li>{t("translationPackages.confirm.noPublish", { locale: pkg.targetLocale })}</li>
          <li>{t("translationPackages.confirm.skipped")}</li>
          <li>{t("translationPackages.confirm.recheck")}</li>
        </ul>
        <label className="mt-4 flex items-start gap-2 text-sm text-ink" htmlFor={`${id}-ack`}>
          <input
            id={`${id}-ack`}
            type="checkbox"
            className="mt-0.5"
            checked={ack}
            disabled={pending}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>{t("translationPackages.confirm.ack", { count: writable })}</span>
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          data-autofocus=""
          onClick={onCancel}
          disabled={pending}
          className={buttonStyles.secondary}
        >
          {t("translationPackages.confirm.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending || !ack}
          aria-busy={pending}
          className={buttonStyles.primary}
        >
          {pending ? <Spinner key="busy" size={14} /> : <Icon key="idle" name="upload" size={16} />}
          <span>
            {pending
              ? t("translationPackages.confirm.running")
              : t("translationPackages.confirm.run", { count: writable })}
          </span>
        </button>
      </DialogFooter>
    </Dialog>
  );
}
