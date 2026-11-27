// COM-1: the corporate navigation and footer from the API's public menu shape.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BvFooterPublic, BvNavPublic } from "@dream/contracts";

import { isCurrentPath, toFooter, toNav } from "./menu-view.ts";
import { localizeLinks } from "./locale-routing.ts";

const link = (label: string, href: string | null) => ({ label, href, newTab: false });

const NAV: BvNavPublic = {
  items: [
    { ...link("Home", "/"), children: [] },
    {
      ...link("Company", null),
      children: [link("About Us", "/about-us"), link("Our Team", null)],
    },
  ],
  contact: link("Contact Us", null),
  noScriptLinks: [],
  pendingNote: "Coming soon",
};

describe("toNav", () => {
  it("marks the current item (and its parent) against the stored address", () => {
    const nav = toNav(NAV, "/about-us");
    assert.equal(nav.items[0]?.current, false);
    assert.equal(nav.items[1]?.current, true);
    assert.equal(nav.items[1]?.children[0]?.current, true);
    assert.equal(nav.items[1]?.children[1]?.href, null, "not ready yet: text, never a 404 link");
    assert.equal(nav.contact?.current, false);
  });

  it("marks the home item only on the home page", () => {
    assert.equal(toNav(NAV, "/").items[0]?.current, true);
    assert.equal(isCurrentPath("/", "/about-us"), false);
    assert.equal(isCurrentPath("https://x.example/about-us", "/about-us"), false);
  });

  it("gets the language prefix of the page with localizeLinks", () => {
    const nav = localizeLinks(toNav(NAV, "/tr/about-us"), "tr");
    assert.equal(nav.items[0]?.href, "/tr");
    assert.equal(nav.items[1]?.children[0]?.href, "/tr/about-us");
  });
});

describe("toFooter", () => {
  it("keeps contact details and links as published", () => {
    const footer: BvFooterPublic = {
      headline: "Global Energy Markets",
      cta: link("Email Us", "mailto:info@dreampetroleum.com"),
      intro: "Intro",
      contact: {
        title: "Contact Us",
        company: "Dream Petroleum",
        addressLines: [{ text: "Istanbul" }],
        phone: {
          label: "+90 212 218 13 57",
          href: "tel:+902122181357",
          note: "Call Us",
          visible: true,
        },
        email: {
          label: "info@dreampetroleum.com",
          href: "mailto:info@dreampetroleum.com",
          note: "Email Us",
          visible: true,
        },
      },
      columns: [{ title: "Company Profile", links: [link("About Us", "/about-us")] }],
      social: [
        { network: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/x" },
      ],
      copyright: "© 2026 - Dream Petroleum",
      legal: [link("Privacy Policy", "/privacy")],
      pendingNote: "Coming soon",
    };
    const view = localizeLinks(toFooter(footer), "en");
    assert.equal(view.cta?.href, "mailto:info@dreampetroleum.com");
    assert.equal(view.columns[0]?.links[0]?.href, "/en/about-us");
    assert.equal(view.legal[0]?.href, "/en/privacy");
    assert.equal(view.contact.phone.href, "tel:+902122181357");
    assert.equal(view.social[0]?.href, "https://www.linkedin.com/company/x");
  });
});
