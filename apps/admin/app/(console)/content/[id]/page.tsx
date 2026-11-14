import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CMS_SITE_REGISTRY,
  CmsHistoryResponseSchema,
  CmsPageResponseSchema,
  cmsDesignTemplate,
  cmsIsArticle,
} from "@dream/contracts";
import { NoticeProvider } from "../../../../components/catalog/notices";
import { PageHeader, SITE_SHORT } from "../../../../components/catalog/parts";
import { PageEditor } from "../../../../components/cms/page-editor";
import { CmsKindPill, publicationState } from "../../../../components/cms/parts";
import { EmptyState, ErrorState, StatusPill } from "../../../../components/ui";
import { serverRead } from "../../../../lib/server-api";
import { requireStaffSession } from "../../../../lib/server-session";

export const metadata: Metadata = { title: "Edit page" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});

/** CMS S1/S2: the draft and publication of one page. The API answers 404 for pages outside the caller's sites. */
export default async function ContentPageEditor({ params }: PageProps<"/content/[id]">) {
  await requireStaffSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const res = await serverRead(`/api/v1/admin/cms/pages/${id}`, CmsPageResponseSchema);
  if (!res.ok && res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title="Page" back={{ href: "/content", label: "All pages" }} />
        <ErrorState title="The page could not be loaded">Try again in a moment.</ErrorState>
      </div>
    );
  }
  const { page, site } = res.data;
  const sp = site.key.toLowerCase();
  const article = cmsIsArticle(page);
  const back = article
    ? { href: `/content/news?site=${sp}`, label: `All articles of ${SITE_SHORT[site.key]}` }
    : { href: `/content?site=${sp}`, label: `All pages of ${SITE_SHORT[site.key]}` };
  const history = await serverRead(
    `/api/v1/admin/cms/pages/${page.id}/history`,
    CmsHistoryResponseSchema,
  );
  const registry = CMS_SITE_REGISTRY.find((e) => e.key === page.templateKey);
  const editable = page.kind === "TEMPLATE" || Boolean(cmsDesignTemplate(page.templateKey));
  const state = publicationState(page);

  return (
    <NoticeProvider>
      <div className="space-y-6 sm:space-y-8">
        <PageHeader
          icon="content"
          title={page.title}
          back={back}
          description={
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {article ? (
                <StatusPill tone="petrol">News article</StatusPill>
              ) : (
                <CmsKindPill kind={page.kind} />
              )}
              <StatusPill tone={state.tone}>{state.label}</StatusPill>
              <span className="font-mono text-ink-3">{page.path ?? "Site-wide part"}</span>
              <span className="text-ink-3">
                · last saved {DATE.format(new Date(page.updatedAt))} by {page.updatedBy.name}
              </span>
            </div>
          }
        />
        {editable ? (
          // Remounted per draft version: a restore or a save from elsewhere shows the new draft.
          <PageEditor
            key={page.version}
            history={history.ok ? history.data : null}
            page={page}
            canEdit={site.canEdit}
            canPublish={site.canPublish}
            siteLabel={SITE_SHORT[site.key]}
            siteKey={site.key}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
            <EmptyState icon="content" title="Edited after the import">
              {registry?.note ?? "This designed page"} Its fields get their own form when the page
              is imported into the CMS; until then the site shows the content from code.
            </EmptyState>
          </div>
        )}
      </div>
    </NoticeProvider>
  );
}
