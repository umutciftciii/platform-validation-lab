// Footer checks: viewports, script on/off, reduced motion, links, contact text, axe, keyboard.
// Usage: node footer.mjs <base-url> <out-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";

const [base = "http://localhost:3110", out = "../footer"] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const LIVE = "https://dreampetroleumbv.com/en";
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const open = async ({ width, height, js = true, reduced = false, touch = false }) => {
  const c = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: js, reducedMotion: reduced ? "reduce" : "no-preference", hasTouch: touch, isMobile: touch });
  const p = await c.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) errors.push(`${r.status()} ${r.url()}`); });
  await p.goto(url, { waitUntil: "load" });
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  return { c, p, errors };
};
const scrollTo = async (p, y) => {
  await p.locator("html").evaluate((_, y) => window.scrollTo({ top: y, behavior: "instant" }), y).catch(() => {});
  await p.waitForTimeout(700);
};
const footerTop = (p) => p.locator(".site-footer").evaluate((e) => Math.round(e.getBoundingClientRect().top + scrollY));
const bottom = (p) => p.locator("html").evaluate(() => document.documentElement.scrollHeight - innerHeight);
const footerLinks = (p) => p.locator(".site-footer a").evaluateAll((els) => els.map((a) => ({ text: (a.getAttribute("aria-label") || a.textContent).trim(), href: a.getAttribute("href") })));
const footerText = (p) => p.locator(".site-footer").evaluate((e) => e.textContent.replace(/\s+/g, " ").trim());

// Rendered at the real viewport, because a beyond-viewport capture misplaces fixed elements.
const VIEWPORTS = [["1440x900", 1440, 900, false], ["1920x1080", 1920, 1080, false], ["375x812", 375, 812, true]];
const linkSets = {};
for (const [name, width, height, touch] of VIEWPORTS) {
  for (const js of [true, false]) {
    const tag = `${name} js-${js ? "on" : "off"}`;
    const { c, p, errors } = await open({ width, height, js, touch });
    const top = await footerTop(p);
    await scrollTo(p, top - 72);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${js ? "js-acik" : "js-kapali"}-${name}-ust.png` });
    await scrollTo(p, await bottom(p));
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${js ? "js-acik" : "js-kapali"}-${name}-alt.png` });
    const overflow = await p.locator("html").evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${tag}: no horizontal overflow`, overflow <= 0, overflow);
    const atEnd = await p.locator(".site-footer-base").evaluate((e) => Math.round(innerHeight - e.getBoundingClientRect().bottom));
    check(`${tag}: page ends at the footer base`, atEnd >= 0 && atEnd < 80, atEnd);
    check(`${tag}: footer sits outside main`, await p.locator("main .site-footer").count() === 0 && await p.locator("body > footer, body footer.site-footer").count() === 1);
    check(`${tag}: old demo placeholder is gone`, !(await p.locator("body").textContent()).includes("End of the demo"));
    linkSets[tag] = await footerLinks(p);
    const text = await footerText(p);
    check(`${tag}: headline and CTA present`, text.includes("Let’s Move Energy Forward.") && text.includes("Get in Touch"));
    check(`${tag}: privacy and terms shown`, text.includes("Privacy Policy") && text.includes("Terms & Conditions"));
    check(`${tag}: no console or asset errors`, errors.length === 0, errors.slice(0, 5));
    if (js) {
      const box = await p.locator(".site-footer").boundingBox();
      check(`${tag}: footer height recorded`, box.height > 0, Math.round(box.height));
      // Full footer on one image: viewport grown to fit, navigation hidden for the picture only.
      const full = await p.locator(".site-footer").evaluate((e) => e.offsetHeight);
      await p.setViewportSize({ width, height: full });
      await p.addStyleTag({ content: ".site-nav{display:none!important}" });
      await scrollTo(p, await bottom(p));
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${out}/tam-footer-${name}.png` });
      await p.setViewportSize({ width, height });
    }
    await c.close();
  }
}
const off = JSON.stringify(linkSets["1440x900 js-off"]);
check("same links with script on and off, all sizes", Object.values(linkSets).every((l) => JSON.stringify(l) === off), Object.fromEntries(Object.entries(linkSets).map(([k, v]) => [k, v.length])));

// Links -----------------------------------------------------------------------
const links = linkSets["1440x900 js-on"];
check("no href='#' placeholder links", links.every((l) => l.href && l.href !== "#"), links.filter((l) => l.href === "#"));
for (const href of [...new Set(links.map((l) => l.href).filter((h) => h.startsWith("http")))]) {
  const r = await fetch(href, { redirect: "follow" }).catch((e) => ({ status: String(e) }));
  check(`link answers 200: ${href}`, r.status === 200, r.status);
}
const liveHtml = await (await fetch(`${LIVE}`)).text();
const decoded = liveHtml.replace(/&amp;/g, "&").replace(/&copy;/g, "©").replace(/<br\s*\/?>/g, "\n");
const liveHrefs = new Set([...liveHtml.matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
for (const l of links.filter((l) => l.href.startsWith("http") || l.href.startsWith("tel:") || l.href.startsWith("mailto:"))) {
  check(`href exists on the live footer: ${l.text}`, liveHrefs.has(l.href), l.href);
}
{
  const { c, p } = await open({ width: 1440, height: 900 });
  check("Privacy and Terms render as text, not links", (await p.locator(".site-footer-legal a").count()) === 0 && (await p.locator(".site-footer-legal .site-footer-pending").count()) === 2);
  const text = await footerText(p);
  for (const s of ["Dream Petroleum B.V.", "Herengracht 420", "1017 AMSTERDAM", "020 210 13 50", "Mon–Fri 08:30–18:30", "info@dreampetroleumbv.com", "We reply within 24h", "© 2026 Dream Petroleum BV. All rights reserved.", "Dream Petroleum BV is a global leader in the trading and distribution of high-quality base oils and petrochemical products. We add value to the energy sector through our strategic Rotterdam-based logistics network."]) {
    check(`same as live source: ${s.slice(0, 48)}`, decoded.includes(s) && text.includes(s));
  }
  for (const s of ["Pending", "validation", "Validation", "certif", "Certif", "ISO "]) check(`absent from footer: "${s}"`, !text.includes(s));
  const digits = text.replace(/020 210 13 50|08:30–18:30|24h|Herengracht 420|1017|2026|Group I, II & III/g, "");
  check("no other figures in the footer", !/\d/.test(digits), digits.match(/.{0,20}\d.{0,20}/g));

  // Structure and colour ------------------------------------------------------
  check("one footer nav landmark with a name", (await p.locator(".site-footer nav[aria-label]").count()) === 1);
  const headings = await p.locator(".site-footer :is(h1,h2,h3,h4)").evaluateAll((e) => e.map((h) => `${h.tagName}:${h.textContent}`));
  check("heading order is h2 then h3", headings[0].startsWith("H2") && headings.slice(1).every((h) => h.startsWith("H3")), headings);
  check("contact is in address", (await p.locator(".site-footer address a[href^='tel:']").count()) === 1 && (await p.locator(".site-footer address a[href^='mailto:']").count()) === 1);
  const amber = await p.locator(".site-footer *:not(img)").evaluateAll((els) => els.filter((e) => getComputedStyle(e).color === "rgb(233, 162, 59)").length);
  check("no amber text at rest", amber === 0, amber);
  const link = p.locator(".site-footer-nav a").first();
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await p.waitForTimeout(300);
  check("link hover turns amber", (await link.evaluate((e) => getComputedStyle(e).color)) === "rgb(233, 162, 59)");
  await c.close();
}

// Motion ----------------------------------------------------------------------
for (const [name, width, height, touch] of VIEWPORTS.filter((v) => v[0] !== "1920x1080")) {
  for (const reduced of [false, true]) {
    const { c, p } = await open({ width, height, reduced, touch });
    await scrollTo(p, await footerTop(p) - 72);
    const anims = await p.locator(".site-footer").evaluate((e) => e.getAnimations({ subtree: true }).length);
    const opacity = await p.locator(".site-footer-call").evaluate((e) => Number(getComputedStyle(e).opacity));
    await scrollTo(p, await bottom(p));
    const endOpacity = await p.locator(".site-footer-call").evaluate((e) => Number(getComputedStyle(e).opacity));
    const lineMatrix = await p.locator(".site-footer-line").evaluate((e) => getComputedStyle(e).transform);
    if (reduced) {
      check(`${name} reduced motion: no animation, at rest`, anims === 0 && opacity === 1 && lineMatrix === "none", { anims, opacity, lineMatrix });
      await scrollTo(p, await footerTop(p) - 72);
      await p.screenshot({ path: `${out}/azaltilmis-hareket-${name}.png` });
    } else {
      check(`${name}: two CSS entrances, finished at the page end`, anims === 2 && endOpacity === 1 && opacity === 1, { anims, opacity, endOpacity, lineMatrix });
    }
    await c.close();
  }
}

// Accessibility ---------------------------------------------------------------
for (const [name, width, height, touch, reduced] of [...VIEWPORTS, ["1440x900 reduced", 1440, 900, false, true]]) {
  const { c, p } = await open({ width, height, touch, reduced });
  await scrollTo(p, await bottom(p));
  await p.evaluate(axeSource);
  const axe = await p.evaluate(() => window.axe.run(".site-footer"));
  check(`axe ${name}: no violations`, axe.violations.length === 0, axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })));
  check(`axe ${name}: ran rules`, axe.passes.length > 5, axe.passes.length);
  if (touch) {
    const small = await p.locator(".site-footer a").evaluateAll((els) => els.map((a) => [a.textContent.trim() || "logo", a.getBoundingClientRect().height]).filter(([, h]) => h < 44));
    check(`${name}: every footer link at least 44 px tall`, small.length === 0, small);
  }
  await c.close();
}

// Keyboard: tab forward from just before the footer, through every link in order.
{
  const { c, p } = await open({ width: 1440, height: 900 });
  await p.locator(".apps-validation a").last().focus();
  const order = [];
  const bad = [];
  for (let i = 0; i < links.length; i++) {
    await p.keyboard.press("Tab");
    await p.waitForTimeout(450);
    const s = await p.evaluate(() => {
      const a = document.activeElement, r = a.getBoundingClientRect(), st = getComputedStyle(a);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: (a.getAttribute("aria-label") || a.textContent).trim(), inFooter: !!a.closest(".site-footer"), outline: `${st.outlineStyle} ${st.outlineWidth} ${st.outlineColor}`, visible: r.top >= 0 && r.bottom <= innerHeight, uncovered: a === hit || a.contains(hit) };
    });
    order.push(s.text);
    if (!s.inFooter || !s.outline.startsWith("solid 2px") || !s.visible || !s.uncovered) bad.push(s);
    if (i === 0) await p.screenshot({ path: `${out}/klavye-odagi-1440x900.png` });
  }
  check("keyboard: every link focused in order, outlined, on screen, not covered", bad.length === 0 && JSON.stringify(order) === JSON.stringify(links.map((l) => l.text)), { bad, order });
  await c.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(`${out}/dogrulama.json`, JSON.stringify({ passed: results.length - failed.length, total: results.length, results }, null, 1));
console.log(`${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log("FAIL", f.name, JSON.stringify(f.detail));
