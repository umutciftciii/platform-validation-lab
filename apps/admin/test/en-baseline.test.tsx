// ML-11 (DP-242) EN regression: the English console renders exactly as before the dictionary.
// test/fixtures/en-baseline/*.html were recorded by running THIS file on private main 5d6f184
// (before ML-11) with ML11_RECORD_EN set; the current code must render the same HTML in English.
// Only two kinds of difference are removed before comparing: the new language switch (ML-11's one
// visible addition) and React's `<!-- -->` separators between adjacent text nodes (a sentence that
// was "text {value}" is one string now). This file imports nothing ML-11 added, so it runs on both.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false }),
  headers: async () => new Headers({ "x-dp-pathname": "/staff" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/staff",
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("../lib/server-session", () => ({
  getStaffSession: async () => null,
  requireStaffSession: async () => ({
    user: { email: "editor@fixture.invalid", displayName: "Fixture Editor" },
    isSystemOwner: true,
  }),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async () => ({ ok: true, data: { reviewOnly: false } }),
}));

const { default: LoginPage } = await import("../app/login/page");
const { default: EnrolPage } = await import("../app/enrol/page");
const { default: ResetPage } = await import("../app/reset/page");
const { default: NotFound } = await import("../app/not-found");
const { default: Loading } = await import("../app/(console)/loading");
const { default: ConsoleError } = await import("../app/(console)/error");
const sectionModule = await import("../app/(console)/[section]/page");
const { default: ConsoleLayout } = await import("../app/(console)/layout");
const { AppShell } = await import("../components/shell/app-shell");
const { Sidebar } = await import("../components/shell/sidebar");

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "en-baseline");
const RECORD = process.env["ML11_RECORD_EN"] === "1";

/** ML-13b (DP-244): the one navigation entry added since the recording (Translations). */
const TRANSLATIONS_NAV = /<li><a [^>]*href="\/translations">[\s\S]*?<\/a><\/li>/g;
/** DP-298 (ADR-031): the Legal texts entry (shown here because the mocked reads all succeed). */
const LEGAL_TEXTS_NAV = /<li><a [^>]*href="\/legal-texts">[\s\S]*?<\/a><\/li>/g;
/** CRM-1 (ADR-032): the CRM entry (companies) added since the recording. */
const CRM_NAV = /<li><a [^>]*href="\/crm">[\s\S]*?<\/a><\/li>/g;

/**
 * Removes the ML-11 language switch (and its phone-only row), the DP-273 theme-switch tabindex,
 * the ML-13b Translations and DP-298 Legal texts navigation entries and text-node separators.
 */
export function normalize(html: string): string {
  return (
    html
      .replace(TRANSLATIONS_NAV, "")
      .replace(LEGAL_TEXTS_NAV, "")
      .replace(CRM_NAV, "")
      .replace(
        /<div class="mt-3 flex items-center justify-between text-xs text-ink-3 sm:hidden"><span>Language<\/span><div role="radiogroup" aria-label="Language"[\s\S]*?<\/div><\/div>/g,
        "",
      )
      .replace(/<div role="radiogroup" aria-label="Language"[\s\S]*?<\/div>/g, "")
      // DP-273: the theme switch's options carry a roving tabindex (one Tab stop); nothing else.
      .replace(
        /(<button type="button" role="radio" aria-checked="(?:true|false)" aria-label="[^"]*" title="[^"]*") tabindex="(?:0|-1)"/g,
        "$1",
      )
      .replaceAll("<!-- -->", "")
  );
}

const section = (slug: string) => ({ params: Promise.resolve({ section: slug }) }) as never;

const SCREENS: Record<string, () => Promise<ReactElement>> = {
  login: async () => (await LoginPage()) as ReactElement,
  enrol: async () => <EnrolPage />,
  reset: async () => <ResetPage />,
  "not-found": async () => (await NotFound()) as ReactElement,
  loading: async () => (await Loading()) as ReactElement,
  error: async () => (
    <ConsoleError error={Object.assign(new Error("x"), { digest: "123456" })} reset={() => {}} />
  ),
  "section-audit": async () => (await sectionModule.default(section("audit"))) as ReactElement,
  "console-layout": async () => (await ConsoleLayout({ children: <p>page</p> })) as ReactElement,
  "shell-review-only": async () => (
    <AppShell user={{ name: "Reviewer", email: "r@x.test" }} environmentLabel="Staging" reviewOnly>
      <p>page</p>
    </AppShell>
  ),
  "sidebar-compact": async () => <Sidebar compact environmentLabel="Production" />,
};

describe("EN rendering is identical to before ML-11", () => {
  if (RECORD) mkdirSync(DIR, { recursive: true });

  it.each(Object.keys(SCREENS))("%s", async (name) => {
    const html = renderToStaticMarkup(await SCREENS[name]!());
    const file = path.join(DIR, `${name}.html`);
    if (RECORD) {
      writeFileSync(file, `${html}\n`);
      return;
    }
    expect(normalize(html)).toBe(normalize(readFileSync(file, "utf8").replace(/\n$/, "")));
  });

  it("page titles", async () => {
    const titles = {
      section: (await sectionModule.generateMetadata(section("audit"))).title,
      unknown: (await sectionModule.generateMetadata(section("nope"))).title,
    };
    const file = path.join(DIR, "titles.json");
    if (RECORD) {
      writeFileSync(file, `${JSON.stringify(titles, null, 2)}\n`);
      return;
    }
    expect(titles).toEqual(JSON.parse(readFileSync(file, "utf8")));
  });
});
