import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PRIVACY_CONTROLLER, PRIVACY_POLICY_VALUES, fillPrivacyText } from "@dream/contracts";
import { SiteFrame } from "@/components/site-frame";
import { getSiteFrame } from "@/lib/cms";
import { dictionary } from "@/lib/i18n";
import { DEFAULT_LOCALE, isRouteLocale, type RouteLocale } from "@/lib/locale-routing";
import { PRIVACY_PATH, privacyPolicyHref, sitePrivacy } from "@/lib/privacy";

type Params = PageProps<"/[locale]/privacy">["params"];

async function localeOf(params: Params): Promise<RouteLocale> {
  const { locale } = await params;
  return isRouteLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await localeOf(params);
  return {
    title: `${dictionary(locale).privacy.title} — Dream Petroleum`,
    robots: { index: false, follow: false },
  };
}

/**
 * DP-095 D-T5: the privacy policy of the corporate site. DP-298 (ADR-031 D1): the version published
 * in the admin for the page's language, read from the API; without one (or while it cannot be
 * read) the page is a 404 (fail closed). COM-1: at `/<locale>/privacy` inside the site's frame.
 */
export default async function PrivacyPage({ params }: { params: Params }) {
  await connection();
  const locale = await localeOf(params);
  const { gate, texts, locales } = await sitePrivacy(locale);
  if (!gate.publish || !texts) notFound();
  const t = dictionary(locale);
  const frame = await getSiteFrame(PRIVACY_PATH, locale);
  const policy = texts.privacyPolicy;
  const fill = (s: string) =>
    // DP-306: {policyVersion} is the version shown.
    fillPrivacyText(s, PRIVACY_CONTROLLER, PRIVACY_POLICY_VALUES, policy.labels, policy.version);
  return (
    <SiteFrame
      locale={locale}
      nav={frame.nav}
      footer={frame.footer}
      languages={frame.languages}
      privacyHref={privacyPolicyHref(locale, locales)}
    >
      <article className="section">
        <div className="container-site">
          <div className="prose-width legal-text">
            <h1 className="section-title">{t.privacy.title}</h1>
            {gate.draft ? (
              <div role="note" className="notice mt-6">
                <p>
                  <strong>{t.privacy.draft}</strong>
                </p>
                <p>{t.privacy.draftText}</p>
                <ul>
                  {gate.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-sm text-ink-3">
              {t.privacy.version} {policy.version}
            </p>
            {policy.sections.map((section) => (
              <section key={section.id} id={section.id}>
                <h2>{section.title}</h2>
                {section.paragraphs.map((p) => (
                  <p key={p}>{fill(p)}</p>
                ))}
                {section.list ? (
                  <ul>
                    {section.list.map((item) => (
                      <li key={item}>{fill(item)}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </article>
    </SiteFrame>
  );
}
