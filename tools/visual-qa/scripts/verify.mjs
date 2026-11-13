// Checks the fixes from the review brief on a running production build.
// Usage: node verify.mjs <base-url> <review-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [base = "http://localhost:3110", dir = ".."] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const out = {};
const main = `${base}/demo/iccsyn-hero`;

// JavaScript off
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
  const context = await browser.newContext({ viewport, javaScriptEnabled: false, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(main, { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  const box = async (sel) => page.locator(sel).first().boundingBox();
  out[`noJs_${name}`] = {
    h1Visible: await page.locator("noscript h1, h1").filter({ visible: true }).count(),
    plates: await page.locator(".glass-plate").filter({ visible: true }).count(),
    ctaVisible: await page.locator(".hero-cta").filter({ visible: true }).count(),
    posterLoaded: await page.locator("noscript img, .vessel-mask img").filter({ visible: true }).count(),
    animatedHidden: !(await page.locator(".hero-animated").isVisible()),
    pageHeight: (await page.locator("html").boundingBox()).height,
    hasEachCard: ["Passenger", "Transmission", "Hydraulic", "Compressor", "Industrial", "Specialty"].every((t) => text.includes(t)),
    cta: !!(await box(".hero-cta")),
  };
  await page.screenshot({ path: path.join(dir, "ekran-goruntuleri", `06-js-kapali-${name}.png`), fullPage: true });
  await context.close();
}

// CTA does not navigate, nothing on the page 404s
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const bad = [], errors = [];
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(main, { waitUntil: "networkidle" });
  const links = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href"), disabled: a.getAttribute("aria-disabled") })));
  await page.evaluate(() => { document.documentElement.scrollTop = document.querySelector("section").offsetHeight - innerHeight; });
  await page.waitForTimeout(2000);
  // Playwright itself refuses to click an aria-disabled element, so use a raw click.
  const cta = await page.locator(".hero-cta").boundingBox();
  await page.mouse.click(cta.x + cta.width / 2, cta.y + cta.height / 2);
  await page.locator(".hero-cta").focus();
  await page.waitForTimeout(500);
  const afterClick = page.url();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  out.cta = { links, urlAfterClickAndEnter: page.url(), stayedOnDemo: afterClick === main && page.url() === main, http4xx: bad, consoleErrors: errors };
  await context.close();
}

// Real reduced-motion emulation
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const frames = [];
  page.on("request", (r) => { if (/\/(desktop|mobile)\/\d+\.webp/.test(r.url())) frames.push(r.url()); });
  await page.goto(main, { waitUntil: "networkidle" });
  out.reducedMotion = { canvas: await page.locator("canvas").count(), sticky: await page.locator(".sticky").count(), plates: await page.locator(".glass-plate").count(), frameRequests: frames.length };
  await context.close();
}

// Scroll length: wheel notches of 100 px until each landmark is reached
for (const route of ["iccsyn-hero", "iccsyn-hero-compact"]) for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${base}/demo/${route}`, { waitUntil: "networkidle" });
  const geometry = await page.evaluate(() => ({ section: document.querySelector("section").offsetHeight, vh: innerHeight }));
  const travel = geometry.section - geometry.vh;
  const notches = (p) => Math.ceil((p * travel) / 100);
  out[`length_${route}_${name}`] = { travelPx: travel, travelScreens: +(travel / geometry.vh).toFixed(2), notchesToCardsStart: notches(0.12), notchesToAllCards: notches(0.7), notchesToCta: notches(0.85) };
  await context.close();
}
fs.writeFileSync(path.join(dir, "dogrulama.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
