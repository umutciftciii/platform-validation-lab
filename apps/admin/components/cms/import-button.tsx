"use client";

import type { CmsImportResponse } from "@dream/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callCms } from "../../lib/cms-client";
import { FormMessage } from "../catalog/parts";
import { buttonStyles, cx, Spinner } from "../ui";

/**
 * CMS S2 (ADR-020 D7): imports a designed page or fragment from the content that was in code.
 * Step 1 is a dry run (validates, lists what would be created); step 2 creates the draft. The API
 * never overwrites an existing page. Nothing changes on the site until the draft is published.
 */
export function ImportButton({
  siteId,
  siteParam,
  templateKey,
  title,
}: {
  siteId: string;
  siteParam: string;
  templateKey: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState<CmsImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setPending(true);
    setError(null);
    const res = await callCms<CmsImportResponse>(`/sites/${siteId}/import`, {
      key: templateKey,
      dryRun,
    });
    setPending(false);
    if (!res.ok) return setError(res.message);
    if (dryRun) return setChecked(res.data);
    router.push(`/content/${res.data.pageId}?site=${siteParam}`);
  }

  return (
    <div className="space-y-2">
      {checked ? (
        <div
          className="space-y-2 rounded-lg bg-petrol-soft p-3 text-sm ring-1 ring-inset ring-petrol/25"
          role="status"
        >
          <p className="text-ink">
            Check passed: {title} can be imported as a draft with{" "}
            {checked.summary
              .map((s) => (s.items === null ? s.field : `${s.field} (${s.items})`))
              .join(", ")}
            . The site does not change until it is published.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => call(false)}
              disabled={pending}
              className={cx(buttonStyles.primary, "h-9")}
            >
              {pending ? <Spinner /> : null}
              Import as draft
            </button>
            <button
              type="button"
              onClick={() => setChecked(null)}
              disabled={pending}
              className={cx(buttonStyles.secondary, "h-9")}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => call(true)}
          disabled={pending}
          className={cx(buttonStyles.secondary, "h-9")}
        >
          {pending ? <Spinner /> : null}
          Import into CMS
        </button>
      )}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
