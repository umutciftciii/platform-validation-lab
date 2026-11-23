import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogShell } from "@/components/products/catalog-shell";
import { privacyLocale } from "@/lib/catalog-locale";
import { dictionary, interpolate } from "@/lib/i18n";
import type { RouteLocale } from "@/lib/locale-routing";
import { localizeHref } from "@/lib/locale-routing";
import { sitePrivacy } from "@/lib/privacy";
import { PRIVACY_CONTROLLER, PRIVACY_POLICY_VALUES, fillPrivacyText, legalTextsFor } from "@dream/contracts";

/** ML-6: the title in the page's language. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: dictionary(await privacyLocale()).meta.privacy,
    // Draft until the owner's controller details exist (DP-095 D-T2); never indexed as a draft.
    robots: { index: false, follow: false },
  };
}

/**
 * DP-095 D-T5: the privacy policy of this site. Rendered per request: the gate reads the env.
 * ML-3: English only (`/en/privacy`); the Dutch policy needs its own approval (ADR-028 D12).
 * ML-6: the page's own labels come from the site UI dictionary; the policy text itself is the
 * versioned text of @dream/contracts.
 * ML-10: the policy and the form texts of the page's language (`legalTextsFor`). A language whose
 * translation is still under DP-095 review has no page (`PRIVACY_LOCALES`, 404); the English
 * policy is never shown under another language's address.
 */
export default async function PrivacyPage() {
  const locale = await privacyLocale();
  const ui = dictionary(locale);
  return (
    <CatalogShell
      locale={locale}
      crumbs={[{ label: ui.common.home, href: localizeHref(locale, "/") }, { label: ui.privacy.title }]}
    >
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-glass/[0.03]" />}>
        <PrivacyPolicy locale={locale} />
      </Suspense>
    </CatalogShell>
  );
}

async function PrivacyPolicy({ locale }: { locale: RouteLocale }) {
  await connection();
  const gate = sitePrivacy();
  if (!gate.publish) notFound();
  const texts = legalTextsFor(locale);
  // PRIVACY_LOCALES already holds only languages with texts; checked again (fail closed).
  if (!texts || texts.locale !== locale) notFound();
  const policy = texts.privacyPolicy;
  const fill = (t: string) =>
    fillPrivacyText(t, PRIVACY_CONTROLLER, PRIVACY_POLICY_VALUES, policy.labels);
  const ui = dictionary(locale).privacy;
  return (
    <article className="mx-auto max-w-3xl pt-6 lg:pt-10">
      {gate.draft ? (
        <div role="note" className="mb-8 rounded-2xl border border-amber/40 bg-amber/[0.08] px-5 py-4 text-sm text-glass">
          <p className="font-medium">{ui.draftTitle}</p>
          <p className="mt-1 text-steel">{ui.draftText}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-steel">
            {gate.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">{ui.eyebrow}</p>
      <h1 className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] font-medium leading-[1.08] [font-stretch:115%]">
        {ui.title}
      </h1>
      <p className="mt-3 text-sm text-steel">{interpolate(ui.version, { version: policy.version })}</p>
      {policy.sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-10">
          <h2 className="text-xl font-medium text-glass">{section.title}</h2>
          {section.paragraphs.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-glass/90">
              {fill(p)}
            </p>
          ))}
          {section.list ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 leading-relaxed text-glass/90">
              {section.list.map((item) => (
                <li key={item}>{fill(item)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <section id="form-texts" className="mt-10">
        <h2 className="text-xl font-medium text-glass">{ui.formTextsTitle}</h2>
        <p className="mt-3 text-sm text-steel">
          {interpolate(ui.noticeVersion, { version: texts.privacyNotice.version })}
        </p>
        <blockquote className="mt-2 border-l-2 border-amber/50 pl-4 leading-relaxed text-glass/90">
          {texts.privacyNotice.text}
        </blockquote>
        <p className="mt-5 text-sm text-steel">
          {interpolate(ui.consentVersion, { version: texts.marketingConsent.version })}
        </p>
        <blockquote className="mt-2 border-l-2 border-amber/50 pl-4 leading-relaxed text-glass/90">
          {texts.marketingConsent.text}
        </blockquote>
      </section>
    </article>
  );
}
