import type { CmsPage, CmsPageKind, CmsRegistryEntry, CmsSite } from "@dream/contracts";
import type { Translate } from "../../lib/i18n/types";
import { Msg, MsgP } from "../i18n/locale-provider";
import { StatusPill, type PillTone } from "../ui";

// ML-12c (DP-243): the labels are dictionary messages (content.common); the pills are shared by
// server pages and client panels, so they render <Msg> (one text node each, DP-196).
const KIND_TONE: Readonly<Record<CmsPageKind, PillTone>> = {
  TEMPLATE: "petrol",
  DESIGN: "neutral",
  FRAGMENT: "neutral",
};

export function CmsKindPill({ kind }: { kind: CmsPageKind }) {
  return (
    <StatusPill tone={KIND_TONE[kind]}>
      <Msg k={`content.common.kind.${kind}`} />
    </StatusPill>
  );
}

/** Who manages a route that is not (yet) a CMS page. */
export function RegistryPill({ entry }: { entry: CmsRegistryEntry }) {
  switch (entry.managedBy) {
    case "cms_pending":
      return (
        <StatusPill tone={entry.importable ? "amber" : "neutral"}>
          <Msg
            k={
              entry.kind === "FRAGMENT"
                ? "content.common.registry.fragment"
                : entry.kind === "TEMPLATE"
                  ? "content.common.registry.template"
                  : "content.common.registry.design"
            }
          />
          {entry.importable ? (
            <Msg k="content.common.registry.readyToImport" />
          ) : entry.stage === "content" ? (
            <Msg k="content.common.registry.notBuiltYet" />
          ) : (
            <MsgP k="content.common.registry.stage" params={{ stage: String(entry.stage) }} />
          )}
        </StatusPill>
      );
    case "contract":
      return (
        <StatusPill tone="neutral">
          <Msg k="content.common.registry.contract" />
        </StatusPill>
      );
    case "catalog":
      return (
        <StatusPill tone="neutral">
          <Msg k="content.common.registry.catalog" />
        </StatusPill>
      );
  }
}

/** Pick the site from `?site=bv|corporate`; the first readable site otherwise. */
export function pickCmsSite(sites: readonly CmsSite[], param: string | undefined): CmsSite {
  const wanted = param?.toUpperCase();
  return sites.find((s) => s.key === wanted) ?? (sites[0] as CmsSite);
}

/**
 * The page's publication state in one line, for the list, the editor header and the publication
 * panel. A plain function in a module without "use client", so server components may call it.
 */
export function publicationState(
  page: { version: number; publication: CmsPage["publication"] },
  t: Translate,
): {
  tone: "success" | "amber" | "neutral";
  label: string;
} {
  const p = page.publication;
  if (!p) return { tone: "amber", label: t("content.common.publication.draft") };
  if (p.status === "UNPUBLISHED")
    return { tone: "neutral", label: t("content.common.publication.unpublished") };
  if (p.pageVersion !== page.version)
    return { tone: "amber", label: t("content.common.publication.changed") };
  return { tone: "success", label: t("content.common.publication.live") };
}
