-- DP-020 (Blog / News, ADR-020 addendum): news articles are TEMPLATE pages with the template key
-- 'article' at /news/<slug>. Runs as dp_owner (ADR-012A). No table, column, enum or row changes:
-- only the three path CHECK constraints of CMS S1/S2 are replaced by wider ones.
--
--  * A page or revision path is "/", "/<slug>" or, for articles only, "/news/<slug>".
--  * Standard template pages never take "news" as their first segment (the site's /news list).
--  * Every existing row satisfies the new constraints (they only add allowed values, except the
--    reserved "news" slug; the pre-migration check in the runbook confirms no page uses it).

ALTER TABLE "CmsPage" DROP CONSTRAINT "CmsPage_path_format";
ALTER TABLE "CmsPage" DROP CONSTRAINT "CmsPage_template_path";
ALTER TABLE "CmsPageRevision" DROP CONSTRAINT "CmsPageRevision_path_format";

ALTER TABLE "CmsPage"
  ADD CONSTRAINT "CmsPage_path_format" CHECK (
    "path" IS NULL
    OR "path" ~ '^/([a-z0-9]+(-[a-z0-9]+)*)?$'
    OR ("kind" = 'TEMPLATE' AND "templateKey" = 'article'
        AND "path" ~ '^/news/[a-z0-9]+(-[a-z0-9]+)*$')
  ),
  -- TEMPLATE pages use the standard template (never the home page, an app route or a two-letter
  -- locale segment; contracts CMS_RESERVED_SLUGS is the same list) or the article template under
  -- /news/.
  ADD CONSTRAINT "CmsPage_template_path" CHECK (
    "kind" <> 'TEMPLATE' OR (
      "templateKey" = 'standard'
      AND "path" <> '/'
      AND split_part("path", '/', 2) !~ '^[a-z]{2}$'
      AND split_part("path", '/', 2) NOT IN (
        'api', 'demo', 'lead-form', 'news', 'preview', 'privacy', 'product-documents',
        'product-images', 'products', 'robots', 'search', 'sitemap'
      )
    ) OR (
      "templateKey" = 'article'
      AND "path" ~ '^/news/[a-z0-9]+(-[a-z0-9]+)*$'
    )
  );

-- Revisions copy their page's path; the kind is on the page, so a revision accepts both shapes.
ALTER TABLE "CmsPageRevision"
  ADD CONSTRAINT "CmsPageRevision_path_format" CHECK (
    "path" IS NULL
    OR "path" ~ '^/([a-z0-9]+(-[a-z0-9]+)*)?$'
    OR "path" ~ '^/news/[a-z0-9]+(-[a-z0-9]+)*$'
  );
