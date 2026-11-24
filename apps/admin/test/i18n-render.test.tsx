// ML-11 (DP-242): the console in Turkish and English — root `<html lang>` from the cookie, the
// shell, sign-in, enrolment/reset frames, 404, the error boundary and the language switch — plus a
// guard that the ML-11 screens keep no literal English UI text in JSX.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

let cookieValue: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "dp-admin-locale" && cookieValue !== undefined ? { value: cookieValue } : undefined,
    has: () => false,
  }),
  headers: async () => new Headers({ "x-dp-pathname": "/staff" }),
}));
vi.mock("next/font/google", () => ({ Archivo: () => ({ variable: "font-archivo" }) }));
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
    isSystemOwner: false,
  }),
}));
vi.mock("../lib/server-api", () => ({
  serverRead: async () => ({ ok: true, data: { reviewOnly: false } }),
}));

const { default: RootLayout } = await import("../app/layout");
const { default: LoginPage, generateMetadata: loginTitle } = await import("../app/login/page");
const { default: EnrolPage } = await import("../app/enrol/page");
const { default: ResetPage } = await import("../app/reset/page");
const { default: NotFound } = await import("../app/not-found");
const { default: ConsoleError } = await import("../app/(console)/error");
const sectionModule = await import("../app/(console)/[section]/page");
const { default: ConsoleLayout } = await import("../app/(console)/layout");
const { LocaleProvider } = await import("../components/i18n/locale-provider");
const { LanguageSwitcher } = await import("../components/shell/language-switcher");

type Locale = "en" | "tr";

/** Server components read the cookie; client components get the language from the provider. */
async function render(locale: Locale, screen: () => Promise<ReactNode> | ReactNode) {
  cookieValue = locale;
  const node = await screen();
  return renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);
}

const section = (slug: string) => ({ params: Promise.resolve({ section: slug }) }) as never;

beforeEach(() => {
  cookieValue = undefined;
});

describe("root layout: <html lang> follows the cookie", () => {
  it.each([
    [undefined, "en"],
    ["en", "en"],
    ["tr", "tr"],
    ["TR", "en"],
    ["nl", "en"],
    ["tr; Secure", "en"],
    ['"><script>', "en"],
  ])("cookie %s → lang=%s", async (value, lang) => {
    cookieValue = value;
    const html = renderToStaticMarkup(
      (await RootLayout({ children: <p>x</p> } as never)) as ReactElement,
    );
    expect(html).toMatch(new RegExp(`^<html lang="${lang}"`));
    expect(html).not.toContain('<script>"');
  });
});

describe("sign-in, enrolment and reset in Turkish", () => {
  it("login page", async () => {
    const html = await render("tr", () => LoginPage());
    for (const text of [
      "Oturum aç",
      "Personel hesabınızı kullanın",
      "İş e-postası",
      "Parola",
      "Devam et",
    ])
      expect(html).toContain(text);
    expect(html).toContain("Yalnız personel içindir. Her oturum açma kaydedilir.");
    expect(html).not.toMatch(/Work email|Continue<|Staff only/);
    cookieValue = "tr";
    expect((await loginTitle()).title).toBe("Oturum aç");
    cookieValue = "en";
    expect((await loginTitle()).title).toBe("Sign in");
  });

  it("enrolment and reset frames (the flow itself starts in the browser)", async () => {
    const enrol = await render("tr", () => <EnrolPage />);
    expect(enrol).toContain("Erişiminiz, güvenle kuruldu.");
    expect(enrol).toContain("Bağlantınız kontrol ediliyor…");
    expect(enrol).not.toMatch(/<form|type="password"|otpauth/);
    const reset = await render("tr", () => <ResetPage />);
    expect(reset).toContain("İki site için tek konsol.");
    expect(reset).toContain("Bağlantınız kontrol ediliyor…");
  });
});

describe("console shell, 404 and the error boundary", () => {
  it("shell in Turkish: navigation, breadcrumb, skip link, environment, account menu", async () => {
    const html = await render("tr", () => ConsoleLayout({ children: <p>page</p> }));
    for (const text of [
      "İçeriğe geç",
      "Çalışma alanı",
      "Genel bakış",
      "Personel ve erişim",
      "Yönetim konsolu",
      "Yerel geliştirme",
      "Ortam: Yerel geliştirme",
      "Hesap menüsü",
      "Oturumu kapat",
      "Yakında",
    ])
      expect(html, text).toContain(text);
    // Owner console only for the system owner (unchanged rule).
    expect(html).not.toContain("Sistem sahibi konsolu");
    // The breadcrumb names the current page in Turkish.
    expect(html).toMatch(/aria-current="page">Personel ve erişim</);
  });

  it("404 and the placeholder module page", async () => {
    const notFound = await render("tr", () => NotFound());
    expect(notFound).toContain("Sayfa bulunamadı");
    expect(notFound).toContain("Genel bakışa dön");
    const audit = await render("tr", () => sectionModule.default(section("audit")));
    expect(audit).toContain("Denetim kaydı henüz kullanılamıyor");
    cookieValue = "tr";
    expect((await sectionModule.generateMetadata(section("nope"))).title).toBe("Bulunamadı");
  });

  it("error boundary with retry and reference", async () => {
    const html = await render("tr", () => (
      <ConsoleError error={Object.assign(new Error("x"), { digest: "abc" })} reset={() => {}} />
    ));
    expect(html).toContain("Bu sayfa yüklenemedi");
    expect(html).toContain("Referans abc");
    expect(html).toContain("Tekrar dene");
  });
});

describe("language switch", () => {
  it.each<[Locale, string]>([
    ["en", "Language"],
    ["tr", "Dil"],
  ])(
    "is a labelled radio group (%s), each option named in its own language",
    async (locale, label) => {
      const html = await render(locale, () => <LanguageSwitcher />);
      expect(html).toContain(`role="radiogroup" aria-label="${label}"`);
      expect(html).toMatch(
        new RegExp(`role="radio" aria-checked="${locale === "en"}" aria-label="English" lang="en"`),
      );
      expect(html).toMatch(
        new RegExp(`role="radio" aria-checked="${locale === "tr"}" aria-label="Türkçe" lang="tr"`),
      );
      // Native buttons, chosen with Enter or Space. DP-269: one Tab stop (the checked option);
      // the arrow keys, Home and End move between the options (test/dp268-a11y.test.tsx).
      expect(html.match(/<button type="button"/g)).toHaveLength(2);
      expect(html.match(/tabindex="0"/g)).toHaveLength(1);
      expect(html.match(/tabindex="-1"/g)).toHaveLength(1);
    },
  );
});

// --- no literal UI text left in the ML-11 screens --------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ML11_FILES = [
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/login/page.tsx",
  "app/enrol/page.tsx",
  "app/reset/page.tsx",
  "app/(console)/layout.tsx",
  "app/(console)/error.tsx",
  "app/(console)/loading.tsx",
  "app/(console)/[section]/page.tsx",
  "components/auth/auth-frame.tsx",
  "components/auth/enrol-flow.tsx",
  "components/auth/link-parts.tsx",
  "components/auth/login-form.tsx",
  "components/auth/reset-flow.tsx",
  "components/shell/app-shell.tsx",
  "components/shell/language-switcher.tsx",
  "components/shell/sidebar.tsx",
  "components/shell/theme-toggle.tsx",
  "components/shell/user-menu.tsx",
];
const TEXT_ATTRIBUTES = new Set(["aria-label", "title", "alt", "label", "placeholder", "hint"]);
/** Not UI language: the brand mark, a separator, file names, technical tokens. */
const ALLOWED = /^(?:404|·|EN|TR|\.txt|[\s\d:–—…·.,-]*)$/;

function literalTexts(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  const add = (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]/.test(clean) && !ALLOWED.test(clean)) found.push(clean);
  };
  /** String literals an expression can evaluate to: `"x"`, `a ? "x" : "y"`, `a ?? "x"`. */
  const literals = (e: ts.Expression | undefined): void => {
    if (!e) return;
    if (ts.isParenthesizedExpression(e)) return literals(e.expression);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return add(e.text);
    if (ts.isTemplateExpression(e)) return add(e.head.text);
    if (ts.isConditionalExpression(e)) {
      literals(e.whenTrue);
      literals(e.whenFalse);
    }
    if (ts.isBinaryExpression(e)) {
      literals(e.left);
      literals(e.right);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node.getText());
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)))
      literals(node.expression);
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
      if (init && ts.isJsxExpression(init)) literals(init.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("ML-11 screens keep no literal UI text in JSX", () => {
  it.each(ML11_FILES)("%s", (file) => {
    expect(literalTexts(file)).toEqual([]);
  });
});
