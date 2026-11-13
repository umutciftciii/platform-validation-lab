import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { SkeletonShell } from "@dream/ui";
import { PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_VERSION, fillPrivacyText } from "@dream/contracts";
import { sitePrivacy } from "@/lib/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy — Dream Petroleum",
  robots: { index: false, follow: false },
};

/** DP-095 D-T5: privacy policy of the corporate site (skeleton layout until the site exists). */
export default async function PrivacyPage() {
  await connection();
  const gate = sitePrivacy();
  if (!gate.publish) notFound();
  return (
    <SkeletonShell service="web-corporate · privacy" title="Privacy Policy">
      {gate.draft ? (
        <div
          role="note"
          style={{
            border: "1px solid #c98a2b",
            borderRadius: 12,
            padding: "0.75rem 1rem",
            margin: "0 0 1.5rem",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Draft — not for publication</p>
          <p style={{ margin: "0.25rem 0 0", opacity: 0.8 }}>
            Not shown in production until these are settled:
          </p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", opacity: 0.8 }}>
            {gate.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p style={{ opacity: 0.6, fontSize: "0.875rem" }}>Version {PRIVACY_POLICY_VERSION}</p>
      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <section key={section.id} id={section.id}>
          <h2 style={{ fontSize: "1.15rem", margin: "1.75rem 0 0.5rem" }}>{section.title}</h2>
          {section.paragraphs.map((p) => (
            <p key={p} style={{ lineHeight: 1.6 }}>
              {fillPrivacyText(p)}
            </p>
          ))}
          {section.list ? (
            <ul style={{ lineHeight: 1.6 }}>
              {section.list.map((item) => (
                <li key={item}>{fillPrivacyText(item)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </SkeletonShell>
  );
}
