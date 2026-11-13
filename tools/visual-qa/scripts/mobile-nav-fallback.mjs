// Mobile navigation at 320/375/390 with script on and off, with and without reduced motion.
// Usage: node mobile-nav-fallback.mjs <base-url> <json-out> [screenshot-dir]
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";
const axeSource = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const [base = "http://localhost:3110", outFile = "mobile-nav-fallback.json", shots] = process.argv.slice(2);
const route_ = "/demo/iccsyn-hero-products";
setTimeout(() => { console.error("WATCHDOG: test exceeded 6 minutes"); process.exit(2); }, 360000).unref();
const b = await chromium.launch({ channel: "chrome", headless: true });
const report = {};

const state = (p) => p.evaluate(() => {
  const h = document.querySelector(".site-nav"), cs = getComputedStyle(h), before = getComputedStyle(h, "::before");
  const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return getComputedStyle(e).display === "none" ? "hidden" : [r.left, r.top, r.width, r.height].map(Math.round); };
  return { position: cs.position, pointer: cs.pointerEvents, height: h.offsetHeight, scrolled: h.dataset.scrolled, opacity: before.opacity, background: before.backgroundColor, backdrop: before.backdropFilter, transition: before.transitionDuration, inner: rect(".site-nav-inner"), logo: rect(".site-nav-logo"), links: rect(".site-nav-links"), contact: rect(".site-nav-inner > .site-nav-contact"), toggle: rect(".site-nav-toggle"), fallback: rect(".site-nav-fallback"), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
const fallbackLinks = (p) => p.evaluate(() => [...document.querySelectorAll(".site-nav-fallback a")].map((a) => {
  const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { label: a.textContent, href: a.getAttribute("href"), current: a.getAttribute("aria-current"), rect: [r.left, r.top, r.right, r.bottom].map(Math.round), onTop: hit === a || a.contains(hit) };
}));
// axe needs timers, and timers never fire with script off, so it would wait forever.
// It runs on a script-free copy instead: scripts stripped, noscript unwrapped, and the
// (scripting: none) rules switched on, which is what a no-script browser renders.
const axeOnStaticCopy = async (width, height) => {
  const c = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const p = await c.newPage();
  await p.route("**/*", async (route) => {
    const req = route.request();
    if (req.resourceType() === "script") return route.abort();
    if (req.resourceType() !== "document" && req.resourceType() !== "stylesheet") return route.continue();
    const res = await route.fetch();
    let body = await res.text();
    if (req.resourceType() === "document") body = body.replace(/<script\b[\s\S]*?<\/script>/g, "").replace(/<(\/?)noscript>/g, "<$1div>");
    else body = body.replace(/\(scripting:\s*none\)/g, "all");
    return route.fulfill({ response: res, body });
  });
  await p.goto(base + route_, { waitUntil: "load" });
  await p.addScriptTag({ content: axeSource });
  const shown = await p.evaluate(() => getComputedStyle(document.querySelector(".site-nav-fallback")).display);
  const violations = await p.evaluate(async () => (await window.axe.run(".site-nav", { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] })).violations.map((v) => `${v.id} (${v.nodes.length})`));
  await c.close();
  return { fallbackDisplay: shown, violations };
};
const noOverlap = (rects) => rects.every((a, i) => rects.every((c, j) => j <= i || a[2] <= c[0] || c[2] <= a[0] || a[3] <= c[1] || c[3] <= a[1]));

for (const width of [320, 375, 390]) {
  const height = width === 320 ? 568 : 812;
  for (const [mode, js, reduced] of [["off", false, false], ["off-reduced", false, true], ["on", true, false], ["on-reduced", true, true]]) {
    const c = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, javaScriptEnabled: js, reducedMotion: reduced ? "reduce" : "no-preference" });
    const p = await c.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + route_, { waitUntil: "load" });
    if (js) await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.waitForTimeout(500);
    const e = { top: await state(p) };
    if (shots && (mode === "off" || mode === "on")) await p.screenshot({ path: `${shots}/js-${js ? "acik" : "kapali"}-${width}-ust.png` });
    e.firstText = await p.evaluate(() => { const t = [...document.querySelectorAll("main h1, main h2, main p")].find((n) => n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== "hidden"); return t ? Math.round(t.getBoundingClientRect().top + scrollY) : null; });

    if (js) {
      // The hamburger menu has to keep working exactly as before.
      await p.waitForFunction(() => Object.keys(document.querySelector(".site-nav-toggle")).some((k) => k.startsWith("__reactProps")), null, { timeout: 30000 });
      await p.tap(".site-nav-toggle");
      await p.waitForTimeout(350);
      e.menu = await p.evaluate(() => { const d = document.querySelector("#site-menu"), r = d.getBoundingClientRect(); return { open: d.open, rect: [r.left, r.top, r.width, r.height].map(Math.round), links: [...d.querySelectorAll(".site-menu-link")].map((a) => a.textContent), focused: document.activeElement?.className, expanded: document.querySelector(".site-nav-toggle").getAttribute("aria-expanded"), transition: getComputedStyle(d).transitionDuration }; });
      if (shots && mode === "on") await p.screenshot({ path: `${shots}/js-acik-${width}-menu.png` });
      await p.tap(".site-menu-close");
      await p.waitForTimeout(350);
      e.menuAfterClose = await p.evaluate(() => ({ open: document.querySelector("#site-menu").open, focused: document.activeElement?.className }));
      await p.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
      await p.waitForTimeout(500);
      e.scrolled = await state(p);
      e.renderedFallback = await p.evaluate(() => document.querySelectorAll(".site-nav-fallback").length);
    } else {
      const links = await fallbackLinks(p);
      const header = e.top;
      e.links = links;
      e.linkChecks = links.length ? {
        count: links.length,
        allOnTop: links.every((l) => l.onTop),
        minHeight: Math.min(...links.map((l) => l.rect[3] - l.rect[1])),
        inViewport: links.every((l) => l.rect[0] >= 0 && l.rect[2] <= width),
        noLinkOverlap: noOverlap(links.map((l) => l.rect)),
        belowLogo: links.every((l) => l.rect[1] >= header.logo[1] + header.logo[3]),
        insideHeader: links.every((l) => l.rect[3] <= header.height),
        textBelowHeader: e.firstText >= header.height,
      } : null;
      if (links.length) {
        e.tabOrder = [];
        await p.evaluate(() => document.activeElement?.blur());
        for (let i = 0; i < links.length + 2; i++) { await p.keyboard.press("Tab"); e.tabOrder.push(await p.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 24) || document.activeElement?.querySelector?.("img")?.alt?.slice(0, 24) || document.activeElement?.tagName)); }
        await p.evaluate(() => document.activeElement?.blur());
        e.aria = await p.locator(".site-nav-fallback").ariaSnapshot();
        e.axe = await axeOnStaticCopy(width, height);
        // Real taps: every link has to move the page to a section that exists.
        e.taps = [];
        for (const l of links) {
          await p.goto(base + route_, { waitUntil: "load" });
          await p.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
          await p.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await p.waitForTimeout(150);
          await p.tap(`.site-nav-fallback a:text-is("${l.label}")`);
          await p.waitForTimeout(700);
          e.taps.push(await p.evaluate((label) => { const id = location.hash.slice(1), t = id && id !== "top" ? document.getElementById(id) : null; return { label, hash: location.hash, scrollY: Math.round(scrollY), targetTop: t ? Math.round(t.getBoundingClientRect().top) : null }; }, l.label));
        }
        await p.goto(base + route_, { waitUntil: "load" });
      }
      // Walk the page: nothing may paint over the links, and the bar must never cover text.
      const stops = await p.evaluate(() => ["#product-groups", "#services", "#ctl-technology", "#applications"].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top + scrollY)));
      e.scrollWalk = [];
      for (const y of [0, 60, 120, 200, ...stops.map((s) => s - 30)]) {
        await p.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
        await p.waitForTimeout(200);
        e.scrollWalk.push(await p.evaluate((y) => {
          const h = document.querySelector(".site-nav"), bottom = h.getBoundingClientRect().bottom;
          const covered = [...document.querySelectorAll("main h1, main h2, main p, main a, main button")].filter((n) => { const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return r.height > 0 && r.top < bottom && r.bottom > 0 && cs.visibility !== "hidden" && +cs.opacity > 0 && !n.closest(".sr-only") && n.className !== "sr-only" && !cs.clip?.includes("rect(0"); }).map((n) => n.textContent.trim().slice(0, 30));
          return { y, headerBottom: Math.round(bottom), covered, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        }, y));
        if (shots && mode === "off" && y === stops[2] - 30) await p.screenshot({ path: `${shots}/js-kapali-${width}-kaydirilmis.png` });
      }
    }
    e.errors = errors;
    report[`${width} ${mode}`] = e;
    await c.close();
  }
}
await b.close();
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
