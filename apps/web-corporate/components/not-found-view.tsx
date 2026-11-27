/**
 * COM-1: the corporate 404 (HTTP 404, noindex) in the requested address's language, inside the
 * published frame where it can be read.
 */
import { SiteFrame } from "@/components/site-frame";
import { getSiteFrame } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { privacyLink } from "@/lib/privacy";

export async function NotFoundView({ locale }: { locale: RouteLocale }) {
  const t = dictionary(locale);
  const [frame, privacyHref] = await Promise.all([getSiteFrame("/", locale), privacyLink(locale)]);
  return (
    <SiteFrame
      locale={locale}
      nav={frame.nav}
      footer={frame.footer}
      languages={frame.languages}
      privacyHref={privacyHref}
    >
      <article className="page">
        <h1>{t.notFound.title}</h1>
        <p>{t.notFound.text}</p>
        <p>
          <a href={`/${locale}`}>{t.notFound.home}</a>
        </p>
      </article>
    </SiteFrame>
  );
}
