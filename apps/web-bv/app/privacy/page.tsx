import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CatalogShell } from "@/components/products/catalog-shell";
import { sitePrivacy } from "@/lib/privacy";
import {
  LEAD_MARKETING_CONSENT,
  LEAD_PRIVACY_NOTICE,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  fillPrivacyText,
} from "@dream/contracts";

export const metadata: Metadata = {
  title: "Privacy Policy | Dream Petroleum BV",
  // Draft until the owner's controller details exist (DP-095 D-T2); never indexed as a draft.
  robots: { index: false, follow: false },
};

/** DP-095 D-T5: the privacy policy of this site. Rendered per request: the gate reads the env. */
export default function PrivacyPage() {
  return (
    <CatalogShell crumbs={[{ label: "Home", href: "/" }, { label: "Privacy Policy" }]}>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-glass/[0.03]" />}>
        <PrivacyPolicy />
      </Suspense>
    </CatalogShell>
  );
}

async function PrivacyPolicy() {
  await connection();
  const gate = sitePrivacy();
  if (!gate.publish) notFound();
  return (
    <article className="mx-auto max-w-3xl pt-6 lg:pt-10">
      {gate.draft ? (
        <div role="note" className="mb-8 rounded-2xl border border-amber/40 bg-amber/[0.08] px-5 py-4 text-sm text-glass">
          <p className="font-medium">Draft — not for publication</p>
          <p className="mt-1 text-steel">
            This text is not final and is not shown in production until the following are settled:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-steel">
            {gate.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-amber">Privacy</p>
      <h1 className="mt-3 text-[clamp(1.75rem,4vw,2.75rem)] font-medium leading-[1.08] [font-stretch:115%]">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-steel">Version {PRIVACY_POLICY_VERSION}</p>
      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="mt-10">
          <h2 className="text-xl font-medium text-glass">{section.title}</h2>
          {section.paragraphs.map((p) => (
            <p key={p} className="mt-3 leading-relaxed text-glass/90">
              {fillPrivacyText(p)}
            </p>
          ))}
          {section.list ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 leading-relaxed text-glass/90">
              {section.list.map((item) => (
                <li key={item}>{fillPrivacyText(item)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <section id="form-texts" className="mt-10">
        <h2 className="text-xl font-medium text-glass">The texts on our document request form</h2>
        <p className="mt-3 text-sm text-steel">Notice, version {LEAD_PRIVACY_NOTICE.version}</p>
        <blockquote className="mt-2 border-l-2 border-amber/50 pl-4 leading-relaxed text-glass/90">
          {LEAD_PRIVACY_NOTICE.text}
        </blockquote>
        <p className="mt-5 text-sm text-steel">Marketing consent (optional), version {LEAD_MARKETING_CONSENT.version}</p>
        <blockquote className="mt-2 border-l-2 border-amber/50 pl-4 leading-relaxed text-glass/90">
          {LEAD_MARKETING_CONSENT.text}
        </blockquote>
      </section>
    </article>
  );
}
