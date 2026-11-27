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
      <section className="section">
        <div className="container-site">
          <p className="eyebrow">404</p>
          <h1 className="section-title mt-5">{t.notFound.title}</h1>
          <p className="section-lead prose-width mt-6">{t.notFound.text}</p>
          <p className="mt-10">
            <a className="btn btn-primary btn-arrow" href={`/${locale}`}>
              {t.notFound.home}
            </a>
          </p>
        </div>
      </section>
    </SiteFrame>
  );
}
