"use client";

/**
 * DP-173: opens the company catalogue preview of the BV site in a new tab. Each click asks the API
 * for a fresh, short-lived signed link bound to this session; the link stops working when it
 * expires, when the session ends or when the user loses the review role.
 */
import type { CatalogPreviewLinkResponse } from "@dream/contracts";
import { useState } from "react";
import { callCatalog } from "../../lib/catalog-client";
import { Icon } from "../icons";
import { buttonStyles, Spinner } from "../ui";
import { FormMessage } from "./parts";

export function PreviewLinkButton({
  siteId,
  productSlug,
  label = "Open catalogue preview",
}: {
  siteId: string;
  productSlug?: string;
  /** DP-193: the product page calls it "Preview". */
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setPending(true);
    setError(null);
    // Open the tab first (popup blockers allow it only in the click), then point it at the link.
    const tab = window.open("about:blank", "_blank");
    const res = await callCatalog<CatalogPreviewLinkResponse>(
      "POST",
      `/sites/${siteId}/preview-link`,
      {},
    );
    setPending(false);
    if (!res.ok) {
      tab?.close();
      setError(res.message);
      return;
    }
    const url = productSlug ? `${res.data.url}/${productSlug}` : res.data.url;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void open()}
        disabled={pending}
        className={buttonStyles.secondary}
      >
        {pending ? <Spinner /> : <Icon name="eye" size={16} />}
        {label}
      </button>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
    </div>
  );
}
