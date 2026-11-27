// DP-306 (ADR-031 D1): the admin side of the legal text placeholders — the preview the API
// computes (rendered as is: no second implementation in the admin), the missing values, the
// publication refusal and the messages of the new rules, in English and Turkish.
import { renderToStaticMarkup } from "react-dom/server";
import { ALLOWED_PLACEHOLDERS, type LegalTextVersionDetail } from "@dream/contracts";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../components/i18n/locale-provider";
import type { AdminLocale } from "../lib/i18n/config";
import { createTranslator } from "../lib/i18n/translate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
  usePathname: () => "/legal-texts",
}));

const view = await import("../lib/legal-texts-view");
const { VersionPreview } = await import("../components/legal/legal-texts");

const EN = createTranslator("en");
const TR = createTranslator("tr");
const AT = "2026-11-27T09:00:00.000Z";

function detail(preview: LegalTextVersionDetail["preview"]): LegalTextVersionDetail {
  return {
    id: "0190f3a0-0000-7000-8000-000000000306",
    key: "MARKETING_CONSENT",
    locale: "en",
    version: null,
    status: "DRAFT",
    legalReview: "REQUIRED",
    reviewNote: null,
    translatesVersion: null,
    sha256: "b".repeat(64),
    createdAt: AT,
    createdBy: null,
    updatedAt: AT,
    publishedAt: null,
    publishedBy: null,
    reviewApprovedAt: null,
    reviewApprovedBy: null,
    revision: 1,
    text: "Write to {privacyEmail}.",
    preview,
  };
}

const render = (locale: AdminLocale, v: LegalTextVersionDetail) =>
  renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <VersionPreview version={v} />
    </LocaleProvider>,
  );

describe("DP-306 rule messages", () => {
  it("splits a placeholder rule into its rule and name", () => {
    expect(view.parseLegalTextRule("unknown_placeholder:aiProviders")).toEqual({
      rule: "unknown_placeholder",
      line: null,
      name: "aiProviders",
    });
    expect(view.parseLegalTextRule("text_before_section:3")).toEqual({
      rule: "text_before_section",
      line: 3,
      name: null,
    });
  });

  it("explains both new rules in English and Turkish, naming the placeholder", () => {
    expect(view.legalTextRuleMessage("unknown_placeholder:aiProviders", EN)).toContain(
      "{aiProviders} is not a placeholder this document may use",
    );
    expect(view.legalTextRuleMessage("missing_value:privacyEmail", EN)).toContain(
      "{privacyEmail} has no value yet",
    );
    expect(view.legalTextRuleMessage("unknown_placeholder:aiProviders", TR)).toContain(
      "{aiProviders} bu belgede kullanılabilecek bir yer tutucu değil",
    );
    expect(view.legalTextRuleMessage("missing_value:privacyEmail", TR)).toContain(
      "{privacyEmail} için henüz değer yok",
    );
  });
});

describe("DP-306 preview", () => {
  const blocked = detail({
    text: "Write to [pending: privacy contact e-mail].",
    placeholders: ["privacyEmail"],
    missing: ["privacyEmail"],
    publicationProblem: "missing_value:privacyEmail",
  });

  it("shows the API's preview text, the missing values and the refusal (EN)", () => {
    const html = render("en", blocked);
    expect(html).toContain("Preview (as it will be shown)");
    expect(html).toContain("Write to [pending: privacy contact e-mail].");
    expect(html).toContain('<code lang="en"');
    expect(html).toContain("{privacyEmail}");
    expect(html).toContain("Publishing is refused now: {privacyEmail} has no value yet");
  });

  it("is fully Turkish in Turkish (the text itself stays in its own language)", () => {
    const html = render("tr", blocked);
    expect(html).toContain("Önizleme (gösterileceği hâliyle)");
    expect(html).toContain("Eksik değerler");
    expect(html).toContain("Şu anda yayın reddedilir: {privacyEmail} için henüz değer yok");
    expect(html).not.toContain("Missing values");
    expect(html).toContain('lang="en"');
  });

  it("says nothing is missing and shows no refusal when the text is complete", () => {
    const html = render(
      "en",
      detail({ text: "Plain.", placeholders: [], missing: [], publicationProblem: null }),
    );
    expect(html).toContain("No value is missing.");
    expect(html).not.toContain("Publishing is refused");
  });

  it("lists, per document, exactly the placeholders the API allows (one source)", () => {
    expect(ALLOWED_PLACEHOLDERS.PRIVACY_POLICY).toContain("policyVersion");
    expect(ALLOWED_PLACEHOLDERS.CONTACT_NOTICE).not.toContain("aiProviders");
  });
});
