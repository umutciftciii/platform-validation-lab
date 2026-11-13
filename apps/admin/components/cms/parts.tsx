import type { CmsPageKind, CmsRegistryEntry, CmsSite } from "@dream/contracts";
import { StatusPill, type PillTone } from "../ui";

const KIND: Readonly<Record<CmsPageKind, { tone: PillTone; label: string }>> = {
  TEMPLATE: { tone: "petrol", label: "Template page" },
  DESIGN: { tone: "neutral", label: "Designed page" },
  FRAGMENT: { tone: "neutral", label: "Site-wide part" },
};

export function CmsKindPill({ kind }: { kind: CmsPageKind }) {
  const k = KIND[kind];
  return <StatusPill tone={k.tone}>{k.label}</StatusPill>;
}

/** Who manages a route that is not (yet) a CMS page. */
export function RegistryPill({ entry }: { entry: CmsRegistryEntry }) {
  switch (entry.managedBy) {
    case "cms_pending":
      return (
        <StatusPill tone="amber">
          {entry.kind === "FRAGMENT" ? "Site-wide part" : "Designed page"} · import in {entry.stage}
        </StatusPill>
      );
    case "contract":
      return <StatusPill tone="neutral">Legal text, versioned</StatusPill>;
    case "catalog":
      return <StatusPill tone="neutral">Product catalogue</StatusPill>;
  }
}

/** Pick the site from `?site=bv|corporate`; the first readable site otherwise. */
export function pickCmsSite(sites: readonly CmsSite[], param: string | undefined): CmsSite {
  const wanted = param?.toUpperCase();
  return sites.find((s) => s.key === wanted) ?? (sites[0] as CmsSite);
}
