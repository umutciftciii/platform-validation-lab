import type { Metadata } from "next";
import { CmsContextResponseSchema } from "@dream/contracts";
import { PageHeader, SITE_SHORT } from "../../../../../components/catalog/parts";
import { PageCreateForm } from "../../../../../components/cms/page-create-form";
import { pickCmsSite } from "../../../../../components/cms/parts";
import { EmptyState, Panel } from "../../../../../components/ui";
import { serverRead } from "../../../../../lib/server-api";
import { requireStaffSession } from "../../../../../lib/server-session";

export const metadata: Metadata = { title: "New article" };

/** DP-020: creates an empty news article draft; the editor opens next. */
export default async function NewArticlePage({ searchParams }: PageProps<"/content/news/new">) {
  await requireStaffSession();
  const query = await searchParams;
  const context = await serverRead("/api/v1/admin/cms/context", CmsContextResponseSchema);
  const sites = context.ok ? context.data.sites : [];
  const site = sites.length
    ? pickCmsSite(sites, typeof query["site"] === "string" ? query["site"] : undefined)
    : null;
  const sp = site ? site.key.toLowerCase() : "bv";
  const back = { href: `/content/news?site=${sp}`, label: "All articles" };
  if (!site || !site.canEdit) {
    return (
      <div className="space-y-8">
        <PageHeader icon="content" title="New article" back={back} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface">
          <EmptyState icon="shield" title="You cannot write articles on this site">
            Writing articles needs content:edit on the site (Content Editor or Site Admin).
          </EmptyState>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        icon="content"
        title="New article"
        back={back}
        description={`A news article on ${SITE_SHORT[site.key]}. You write its summary, cover and body next.`}
      />
      <Panel id="new-article" title="Article" className="max-w-2xl">
        <PageCreateForm
          siteId={site.id}
          siteParam={sp}
          siteLabel={SITE_SHORT[site.key]}
          template="article"
        />
      </Panel>
    </div>
  );
}
