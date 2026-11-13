"use client";

import { useEffect } from "react";

/**
 * Scrolls to the section named in the address (`/#services`) once the page content is there.
 *
 * CMS pages stream in after the first response, so the browser's own jump to the fragment runs
 * before the section exists and the page stays at the top. This runs after the content has
 * mounted, once per page view; it does nothing without a fragment or a matching element.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || id === "top") return;
    const target = document.getElementById(id);
    if (!target) return;
    // Instant, like the browser's own fragment jump; no animation to respect or interrupt.
    target.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
