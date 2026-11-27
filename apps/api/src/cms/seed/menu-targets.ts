/**
 * COM-5 (DP-038): the targets of the corporate menu seeds on import. A seed names each page by its
 * address (`{ type: "path", path }`); the import turns an address of a CMS page of the site into a
 * reference to that page (DP-219: a link while the page is live, the label as text otherwise), keeps
 * the privacy policy's address (an app page that the site shows only where it is published) and
 * makes any other address "not ready" (`none`). So no menu link can lead to a missing page.
 */
const APP_PATHS = new Set(["/privacy"]);

export function corporateSeedMenuTargets(
  content: unknown,
  pageByPath: ReadonlyMap<string, string>,
): unknown {
  const resolve = (target: unknown): unknown => {
    const t = target as { type?: unknown; path?: unknown } | null;
    if (!t || t.type !== "path" || typeof t.path !== "string") return target;
    if (APP_PATHS.has(t.path)) return target;
    const id = pageByPath.get(t.path);
    return id ? { type: "page", pageId: id } : { type: "none" };
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        k === "target" ? resolve(x) : walk(x),
      ]),
    );
  };
  return walk(content);
}
