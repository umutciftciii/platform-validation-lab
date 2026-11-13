// CMS S2 (DP-134, ADR-020 D7): the import seeds of the BV site and the signed preview tokens.
import { describe, expect, it } from "vitest";
import {
  CMS_DESIGN_TEMPLATES,
  CMS_SITE_REGISTRY,
  CmsSlugSchema,
  CmsTemplateContentSchema,
  cmsAsset,
  cmsPathForSlug,
  cmsFieldsSchema,
  type BvHomeContent,
} from "@dream/contracts";
import {
  PREVIEW_TTL_MS,
  issuePreviewToken,
  validateContent,
  verifyPreviewToken,
} from "../../../src/cms/cms-content.js";
import { BV_FOOTER_SEED, BV_HOME_SEED, BV_NAV_SEED, CMS_SEEDS } from "../../../src/cms/seed/bv.js";
import { CMS_PAGE_SEEDS } from "../../../src/cms/seed/bv-pages.js";

describe("BV import seeds", () => {
  it("has exactly one seed per designed template, and each validates unchanged", () => {
    expect(Object.keys(CMS_SEEDS).sort()).toEqual(CMS_DESIGN_TEMPLATES.map((t) => t.key).sort());
    for (const t of CMS_DESIGN_TEMPLATES) {
      const seed = CMS_SEEDS[t.key]!.content;
      const parsed = cmsFieldsSchema(t.fields).safeParse(seed);
      expect(parsed.success, `${t.key}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(
        true,
      );
      // Validation keeps the content as it was (no trimming or defaults change a word).
      expect(parsed.data).toEqual(seed);
    }
  });

  it("keeps the claims and disclosures the source documents require", () => {
    const home: BvHomeContent = BV_HOME_SEED;
    expect(home.applications.status).toBe("Pending Technical Validation");
    expect(
      home.applications.scenes.every((s) => s.disclosure.startsWith("AI-generated concept image")),
    ).toBe(true);
    expect(home.hero.applications.at(-1)?.description).toContain("must be confirmed by testing");
    expect(home.productGroups.groups.find((g) => g.anchor === "group-3-plus")?.note).toContain(
      "not a separate API group",
    );
    expect(home.services.disclosure).toContain("do not show Dream Petroleum facilities");
    expect(home.ctl.stages.every((s) => s.disclosure.length > 0)).toBe(true);
  });

  it("uses only registered assets of the right kind", () => {
    const images = [
      ...BV_HOME_SEED.hero.applications.map((a) => a.image),
      ...BV_HOME_SEED.productGroups.groups.map((g) => g.poster),
      ...BV_HOME_SEED.services.items.flatMap((s) => [s.desktopImage, s.mobileImage]),
      ...BV_HOME_SEED.ctl.stages.map((s) => s.image),
      ...BV_HOME_SEED.applications.scenes.flatMap((s) => [s.image, s.imageSmall]),
    ];
    for (const src of images) expect(cmsAsset(src)?.kind, src).toBe("image");
    for (const g of BV_HOME_SEED.productGroups.groups)
      expect(cmsAsset(g.animation)?.kind).toBe("animation");
  });

  it("keeps the official contact details and pending pages as plain text", () => {
    expect(BV_FOOTER_SEED.contact.phone.href).toBe("tel:+31202101350");
    expect(BV_FOOTER_SEED.contact.email.href).toBe("mailto:info@dreampetroleumbv.com");
    expect(BV_NAV_SEED.items.filter((i) => i.href === null).map((i) => i.label)).toEqual([
      "Services",
      "Company",
      "Blogs",
      "Contact Us",
    ]);
    expect(
      BV_NAV_SEED.noScriptLinks.every((l) => l.href?.startsWith("/") || l.href === "#top"),
    ).toBe(true);
  });

  it("reports invalid content with content.* paths", () => {
    let error: unknown;
    try {
      validateContent("DESIGN", "bv.home", {
        ...BV_HOME_SEED,
        hero: { ...BV_HOME_SEED.hero, brand: "" },
      });
    } catch (e) {
      error = e;
    }
    expect(JSON.stringify(error)).toContain("content.hero.brand");
  });
});

describe("BV content page seeds (DP-135)", () => {
  const seeds = Object.entries(CMS_PAGE_SEEDS);

  it("has one seed per importable content page of the registry, at the registry path", () => {
    const importable = CMS_SITE_REGISTRY.filter((e) => e.kind === "TEMPLATE" && e.importable);
    expect(seeds.map(([k]) => k).sort()).toEqual(importable.map((e) => e.key).sort());
    for (const [key, seed] of seeds) {
      expect(CmsSlugSchema.parse(seed.slug), key).toBe(seed.slug);
      expect(cmsPathForSlug(seed.slug)).toBe(importable.find((e) => e.key === key)?.path);
    }
  });

  it("validates unchanged as template content, with registered images only", () => {
    for (const [key, seed] of seeds) {
      const parsed = CmsTemplateContentSchema.safeParse(seed.content);
      expect(parsed.success, `${key}: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(
        true,
      );
      expect(parsed.data).toEqual(seed.content);
      for (const s of seed.content.sections) {
        if (s.type === "split") expect(cmsAsset(s["image"] as string)?.kind, key).toBe("image");
      }
    }
  });

  it("keeps the CGI disclosure, drops the leftover brand and the unsourced growth figure", () => {
    const text = JSON.stringify(CMS_PAGE_SEEDS);
    expect(text).not.toContain("Dream Chemicals");
    expect(text).not.toContain("+12%");
    expect(text).not.toContain("contact-us.html");
    for (const [key, seed] of seeds) {
      for (const s of seed.content.sections.filter((x) => x.type === "split")) {
        expect(s["imageNote"], key).toMatch(/^Illustrative CGI image\./);
      }
    }
  });
});

describe("preview tokens", () => {
  const key = Buffer.alloc(32, 7);
  const page = "0190f2a1-0000-7000-8000-000000000000";
  const now = new Date("2026-11-13T12:00:00Z");

  it("verifies for its page and site within 15 minutes", () => {
    const { token, expiresAt } = issuePreviewToken(key, page, "BV", now);
    expect(expiresAt.getTime() - now.getTime()).toBe(PREVIEW_TTL_MS);
    expect(verifyPreviewToken(key, token, "BV", now)).toBe(page);
    expect(verifyPreviewToken(key, token, "BV", new Date(now.getTime() + PREVIEW_TTL_MS - 1))).toBe(
      page,
    );
  });

  it("refuses another site, expiry, another key and any change", () => {
    const { token } = issuePreviewToken(key, page, "BV", now);
    expect(verifyPreviewToken(key, token, "CORPORATE", now)).toBeNull();
    expect(
      verifyPreviewToken(key, token, "BV", new Date(now.getTime() + PREVIEW_TTL_MS)),
    ).toBeNull();
    expect(verifyPreviewToken(Buffer.alloc(32, 8), token, "BV", now)).toBeNull();
    const other = token.replace(page, "0190f2a1-0000-7000-8000-000000000001");
    expect(verifyPreviewToken(key, other, "BV", now)).toBeNull();
    const longer = token.replace(/\.(\d+)\./, (_m, exp: string) => `.${Number(exp) + 86_400_000}.`);
    expect(verifyPreviewToken(key, longer, "BV", now)).toBeNull();
    expect(verifyPreviewToken(key, "v1.x", "BV", now)).toBeNull();
  });
});
