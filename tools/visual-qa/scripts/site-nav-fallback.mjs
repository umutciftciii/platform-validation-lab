// Navbar state with script on and off, at phone and desktop size, for before/after comparison.
// Usage: node site-nav-fallback.mjs <base-url> <json-out> [screenshot-dir]
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
const [base = "http://localhost:3110", outFile = "site-nav-fallback.json", shots] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const b = await chromium.launch({ channel: "chrome", headless: true });
const report = {};
const nav = (p) => p.evaluate(() => {
  const h = document.querySelector(".site-nav"), before = getComputedStyle(h, "::before");
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return getComputedStyle(e).display === "none" ? "hidden" : [r.left, r.top, r.width, r.height].map(Math.round); };
  return { scrolled: h.dataset.scrolled, pointer: getComputedStyle(h).pointerEvents, height: h.offsetHeight, opacity: before.opacity, background: before.backgroundColor, backdrop: before.backdropFilter, transition: before.transitionDuration, logo: rect(".site-nav-logo"), links: rect(".site-nav-links"), contact: rect(".site-nav-inner > .site-nav-contact"), toggle: rect(".site-nav-toggle"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
const scrollToY = async (p, y, wait) => { await p.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await p.waitForTimeout(wait); };
for (const [name, width, height, touch] of [["375x812", 375, 812, true], ["1440x900", 1440, 900, false]]) {
  for (const [mode, js, reduced] of [["off", false, false], ["on", true, false], ["on-reduced", true, true]]) {
    const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, javaScriptEnabled: js, reducedMotion: reduced ? "reduce" : "no-preference" });
    const p = await c.newPage();
    await p.goto(url, { waitUntil: "load" });
    if (js) await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(500);
    const entry = { top: await nav(p) };
    // First text on the page must start below the bar when it is opaque.
    entry.firstTextTop = await p.evaluate(() => { const e = document.querySelector("main h1, main h2, main p"); return e ? Math.round(e.getBoundingClientRect().top) : null; });
    if (shots && mode !== "on-reduced") await p.screenshot({ path: `${shots}/js-${mode === "off" ? "kapali" : "acik"}-${name}-ust.png` });
    const stops = await p.evaluate(() => ["#ctl-technology", "#ctl-technology .ctl-stage:nth-child(2)", "#applications", "#applications .apps-scene:nth-child(2)", ".apps-validation"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY)));
    const bands = [];
    for (const y of stops) {
      await scrollToY(p, y - 30, js ? 700 : 900);
      bands.push(crypto.createHash("md5").update(await p.screenshot({ clip: { x: 0, y: 0, width, height: 72 } })).digest("hex"));
    }
    if (shots && mode !== "on-reduced") { await scrollToY(p, stops[1] - 30, 1200); await p.screenshot({ path: `${shots}/js-${mode === "off" ? "kapali" : "acik"}-${name}-kaydirilmis.png` }); }
    entry.scrolled = await nav(p);
    entry.distinctBands = new Set(bands).size;
    await scrollToY(p, 0, 500);
    entry.backAtTop = await nav(p);
    report[`${name} ${mode}`] = entry;
    await c.close();
  }
}
await b.close();
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
