import {
  jsonLdText,
  organizationJsonLd,
  productJsonLd,
  type PublicProduct,
} from "@dream/contracts";

import { imageSrc } from "@/lib/catalog-api";
import { LOGO_PATH, ORGANIZATION_NAME, sitePolicy } from "@/lib/seo";

/**
 * DP-207: schema.org structured data. Rendered at request time (the origin comes from the
 * server environment); without a public origin nothing is rendered rather than wrong URLs.
 */
function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // jsonLdText escapes "<", so content can never close the script element.
      dangerouslySetInnerHTML={{ __html: jsonLdText(data) }}
    />
  );
}

/** The company (home page): legal name, site URL and logo only; no invented contact data. */
export function OrganizationJsonLd() {
  const { origin } = sitePolicy();
  if (!origin) return null;
  return <JsonLd data={organizationJsonLd({ name: ORGANIZATION_NAME, origin, logoPath: LOGO_PATH })} />;
}

/** A published product, from its approved snapshot only (no price, rating or review). */
export function ProductJsonLd({ product: p }: { product: PublicProduct }) {
  const { origin } = sitePolicy();
  if (!origin) return null;
  return (
    <JsonLd
      data={productJsonLd({
        origin,
        path: `/products/${p.slug}`,
        name: p.name,
        code: p.code,
        description: p.summary ?? p.description,
        category: p.category.name,
        imagePaths: p.images.slice(0, 3).map((i) => imageSrc(i.id, "display")),
      })}
    />
  );
}
