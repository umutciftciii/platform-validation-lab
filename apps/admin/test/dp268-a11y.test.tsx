// DP-268 / DP-269: the semantics of the console's modal dialog and of the language radio group in
// the server render, and their keyboard rules as pure functions. The behaviour in a browser (focus
// on open, Tab wrap, Escape, focus back, inert page, arrow keys) is covered by the isolated
// production-mode fixture (Dream Petroleumbv/dp-268-fixture); there is no DOM in these unit tests.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { wrapTarget } from "../components/dialog";
import { radioKeyTarget } from "../lib/radio-keys";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/",
}));

const { ConfirmDialog, Dialog, DialogBody, DialogFooter } = await import("../components/dialog");
const { RemoveRoleButton } = await import("../components/staff/staff-actions");
const { ModuleSwitch } = await import("../components/owner/owner-actions");
const { PublicationPanel } = await import("../components/cms/publication-panel");
const { LanguageSwitcher } = await import("../components/shell/language-switcher");
const { LocaleProvider } = await import("../components/i18n/locale-provider");

const attr = (html: string, tag: string, name: string) =>
  new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

describe("modal dialog (DP-268)", () => {
  it("is a named, described modal with its own title", () => {
    const html = renderToStaticMarkup(
      <Dialog title="Change CRM" description="Recorded." onClose={() => undefined}>
        <DialogBody>
          <input aria-label="Reason" />
        </DialogBody>
        <DialogFooter>
          <button type="button">Cancel</button>
        </DialogFooter>
      </Dialog>,
    );
    expect(html).toMatch(/^<dialog role="dialog" aria-modal="true"/);
    const labelledBy = attr(html, "dialog", "aria-labelledby");
    const describedBy = attr(html, "dialog", "aria-describedby");
    expect(html).toContain(`<h2 id="${labelledBy}"`);
    expect(html).toContain(`id="${describedBy}"`);
    // ML-14 (DP-274): the title text sits in a span (room for the danger icon).
    expect(html).toMatch(/>Change CRM<\/span><\/h2>/);
    // Not open in the HTML: the browser opens it with showModal() (top layer, inert page).
    expect(html).not.toMatch(/<dialog[^>]*\sopen[\s>=]/);
    // Scrollable body, action bar after it.
    expect(html.indexOf("data-dialog-body")).toBeLessThan(html.indexOf(">Cancel<"));
  });

  it("a confirmation is an alertdialog that starts on the safe button", () => {
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
    expect(html).toMatch(/^<dialog role="alertdialog" aria-modal="true"/);
    expect(html).toMatch(/<button type="button" data-autofocus=""[^>]*>Cancel<\/button>/);
    // Cancel first, confirm last: right-most on wide screens, on top on phones (column-reverse).
    expect(html.indexOf(">Cancel<")).toBeLessThan(html.lastIndexOf(">Delete redirect<"));
    expect(html).toContain("flex-col-reverse");
    expect(html).toContain("sm:justify-end");
  });

  it("busy: the dialog says so and both buttons wait", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        title="Publish now"
        confirmLabel="Publish now"
        cancelLabel="Cancel"
        pending
        error="The page changed."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toContain('<p role="alert" class="text-sm text-danger">The page changed.</p>');
  });

  it("keeps the opening buttons on the page and marks them as opening a dialog", () => {
    const remove = renderToStaticMarkup(
      <RemoveRoleButton assignmentId="a" label="Sales / CRM User from Sam Sales" />,
    );
    expect(remove).toContain('aria-label="Remove Sales / CRM User from Sam Sales"');
    expect(remove).toContain('aria-haspopup="dialog"');
    const sw = renderToStaticMarkup(
      <ModuleSwitch
        module={{ key: "crm", name: "CRM", isCore: false }}
        site={{ id: "s", key: "BV", name: "Dream Petroleum BV" } as never}
        enabled
      />,
    );
    expect(sw).toContain(
      'aria-label="Switch off CRM on Dream Petroleum BV" aria-haspopup="dialog"',
    );
  });

  it("the publish button is a dialog trigger and no confirmation is open at first", () => {
    const html = renderToStaticMarkup(
      <PublicationPanel
        page={{ id: "p", publication: null } as never}
        version={1}
        dirty={false}
        canPublish
        previewable={false}
      />,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<dialog");
  });
});

describe("Tab wrap inside a dialog (DP-268)", () => {
  it.each([
    // count, current, backwards, expected
    [3, 2, false, 0], // Tab on the last control → first
    [3, 0, true, 2], // Shift+Tab on the first → last
    [3, 1, false, null], // in the middle: the browser's own move stays inside
    [3, 1, true, null],
    [3, -1, false, 0], // focus outside the controls (the dialog itself) → first
    [3, -1, true, 2],
    [1, 0, false, 0],
    [0, -1, false, null],
  ] as const)("count %i, at %i, back %s → %s", (count, current, back, expected) => {
    expect(wrapTarget(count, current, back)).toBe(expected);
  });
});

describe("language radio group (DP-269)", () => {
  it.each([
    ["ArrowRight", 0, 1],
    ["ArrowDown", 0, 1],
    ["ArrowRight", 1, 0], // wraps
    ["ArrowLeft", 1, 0],
    ["ArrowUp", 1, 0],
    ["ArrowLeft", 0, 1], // wraps
    ["Home", 1, 0],
    ["End", 0, 1],
    ["Tab", 0, null],
    ["Enter", 0, null],
    [" ", 0, null],
  ] as const)("%s from %i → %s", (key, from, to) => {
    expect(radioKeyTarget(key, from, 2)).toBe(to);
  });

  it.each(["en", "tr"] as const)("is one Tab stop: only the checked option (%s)", (locale) => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale={locale}>
        <LanguageSwitcher />
      </LocaleProvider>,
    );
    const en = /<button[^>]*lang="en"[^>]*>/.exec(html)![0];
    const tr = /<button[^>]*lang="tr"[^>]*>/.exec(html)![0];
    expect(en).toContain(`aria-checked="${locale === "en"}"`);
    expect(en).toContain(`tabindex="${locale === "en" ? 0 : -1}"`);
    expect(tr).toContain(`aria-checked="${locale === "tr"}"`);
    expect(tr).toContain(`tabindex="${locale === "tr" ? 0 : -1}"`);
  });
});
