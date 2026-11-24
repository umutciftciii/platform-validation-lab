// ML-14 (DP-271, DP-273, DP-274): accessibility and visual polish of the console, in the server
// render. Keyboard and focus behaviour in a browser, the entrance animation and the phone layout are
// covered by the isolated production-mode fixture (Dream Petroleumbv/ml-14-fixture); there is no
// DOM in these unit tests.
import { cmsMenuSchema } from "@dream/contracts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "../lib/i18n/translate";
import { FOOTER_CONTENT, MENU_TARGETS, NAV_CONTENT } from "./support/content-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
}));

const { ConfirmDialog, Dialog, DialogBody, DialogFooter } = await import("../components/dialog");
const { MenuEditor } = await import("../components/cms/menu-editor");
const { NoticeProvider } = await import("../components/catalog/notices");
const { ThemeToggle } = await import("../components/shell/theme-toggle");
const { LocaleProvider } = await import("../components/i18n/locale-provider");

const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
const duplicates = (list: string[]) => list.filter((x, i) => list.indexOf(x) !== i);

describe("menu editors have unique ids (DP-271)", () => {
  it.each([
    ["bv.site-nav", NAV_CONTENT],
    ["bv.site-footer", FOOTER_CONTENT],
  ] as const)("%s", (key, content) => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">
        <NoticeProvider>
          <MenuEditor
            menuKey={key}
            value={cmsMenuSchema(key).parse(content) as never}
            targets={MENU_TARGETS as never}
            readOnly={false}
            invalid={() => undefined}
            onChange={() => undefined}
          />
        </NoticeProvider>
      </LocaleProvider>,
    );
    expect(duplicates(ids(html))).toEqual([]);
    // Every label points at a form control, never at a heading.
    for (const m of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) {
      const target = new RegExp(`<(\\w+)[^>]*\\sid="${m[1]}"`).exec(html)?.[1];
      expect(["input", "textarea", "select", "button"], `label for=${m[1]}`).toContain(target);
    }
    if (key === "bv.site-footer") {
      expect(html).toContain('<h2 id="footer-contact-title"');
      expect(html).toMatch(/<label[^>]*for="footer-contact-heading"/);
      expect(html).toMatch(/<input[^>]*id="footer-contact-heading"/);
    }
  });
});

describe("theme switch radio group (DP-273)", () => {
  it.each(["en", "tr"] as const)(
    "server render: no theme checked yet, the first option is the one Tab stop (%s)",
    (locale) => {
      const html = renderToStaticMarkup(
        <LocaleProvider locale={locale}>
          <ThemeToggle />
        </LocaleProvider>,
      );
      const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
      expect(radios).toHaveLength(3);
      expect(radios.every((r) => r.includes('aria-checked="false"'))).toBe(true);
      expect(radios.map((r) => /tabindex="(-?\d)"/.exec(r)?.[1])).toEqual(["0", "-1", "-1"]);
    },
  );

  it("uses the shared radio-group keys", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "../components/shell/theme-toggle.tsx"), "utf8");
    expect(src).toContain("radioKeyTarget(e.key, from, OPTIONS.length)");
    expect(src).toContain("onKeyDown={onKeyDown}");
  });
});

describe("dialog polish (DP-274)", () => {
  it("V-2: every dialog carries the entrance-animation class; reduced motion turns it off", () => {
    const html = renderToStaticMarkup(
      <Dialog title="Edit" onClose={() => undefined}>
        <DialogBody />
      </Dialog>,
    );
    expect(html).toMatch(/^<dialog[^>]*class="dp-dialog /);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(path.join(here, "../app/globals.css"), "utf8");
    expect(css).toMatch(/@starting-style\s*{\s*\.dp-dialog\[open\]\s*{\s*opacity: 0;/);
    expect(css).toMatch(
      /\.dp-dialog\s*{\s*transition:\s*opacity 150ms ease-out,\s*translate 150ms/,
    );
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.dp-dialog,\s*\.dp-dialog::backdrop\s*{\s*transition: none;/);
    // The backdrop's own tint is unchanged (V-1 closed: the background look stays as it is).
    expect(html).toContain("backdrop:bg-[#07121f]/55");
  });

  it("V-3: a danger confirmation's text is neutral; red stays on the button and the icon", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Delete redirect"
        text="Delete /old?"
        confirmLabel="Delete redirect"
        cancelLabel="Cancel"
        danger
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toMatch(
      /<div id="[^"]+" class="break-words text-sm text-ink-2"><p>Delete \/old\?<\/p>/,
    );
    expect(html).not.toMatch(/<p class="text-danger">/);
    expect(html).toMatch(
      /<h2[^>]*><svg[^>]*aria-hidden="true"[^>]*class="mt-0.5 shrink-0 text-danger"/,
    );
    expect(html).toMatch(/<button type="button" class="[^"]*bg-danger/);
    const safe = renderToStaticMarkup(
      <ConfirmDialog
        title="Publish now"
        text="Goes live."
        confirmLabel="Publish now"
        cancelLabel="Cancel"
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(safe).not.toContain("<svg");
  });

  it("V-4: a footer hint follows the buttons in the DOM, left on wide screens, on top on phones", () => {
    const html = renderToStaticMarkup(
      <DialogFooter hint="Takes effect on the site at once.">
        <button type="button">Cancel</button>
        <button type="submit">Save</button>
      </DialogFooter>,
    );
    expect(html).toContain("flex-col-reverse");
    expect(html).toMatch(
      />Save<\/button><span class="text-xs text-ink-3 sm:order-first sm:mr-auto">Takes effect/,
    );
  });

  it("V-4: a dialog form can have a close (×) button; confirmations have none", () => {
    const form = renderToStaticMarkup(
      <Dialog title="Switch off CRM" closeLabel="Close" onClose={() => undefined}>
        <DialogBody />
      </Dialog>,
    );
    expect(form).toContain('aria-label="Close"');
    const confirm = renderToStaticMarkup(
      <ConfirmDialog
        title="Remove role"
        confirmLabel="Remove"
        cancelLabel="Keep"
        pending={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(confirm).not.toContain('aria-label="Close"');
  });

  it("V-4: the role removal has a short title and asks the question in its text (EN, TR)", () => {
    const label = { label: "Content editor from Sam" };
    const en = createTranslator("en");
    expect(en("staff.remove.title")).toBe("Remove role");
    expect(en("staff.remove.question", label)).toBe("Remove Content editor from Sam?");
    const tr = createTranslator("tr");
    expect(tr("staff.remove.title")).toBe("Rolü kaldır");
    expect(
      tr("staff.remove.question", {
        label: tr("staff.page.removeLabel", { name: "Ayşe", role: "İçerik editörü" }),
      }),
    ).toBe("Ayşe kişisinden İçerik editörü rolü kaldırılsın mı?");
    expect(en("common.dialog.close")).toBe("Close");
    expect(tr("common.dialog.close")).toBe("Kapat");
  });
});
