import { connection } from "next/server";

import { SkeletonShell } from "@dream/ui";
import { PRIVACY_PATH, sitePrivacy } from "@/lib/privacy";

export default async function Home() {
  await connection();
  const showPrivacy = sitePrivacy().publish;
  return (
    <SkeletonShell service="web-corporate · :3111" title="Corporate site skeleton">
      <p>
        Placeholder for dreampetroleum.com. Locales, pages and content will come from the shared CMS
        (backlog DP-027…DP-030). No business content is published here yet.
      </p>
      {showPrivacy ? (
        <footer style={{ marginTop: "2rem", fontSize: "0.875rem", opacity: 0.8 }}>
          {/* DP-095 D-T5: footer link to the policy, only where it is published. */}
          <a href={PRIVACY_PATH} style={{ color: "inherit" }}>
            Privacy Policy
          </a>
        </footer>
      ) : null}
    </SkeletonShell>
  );
}
