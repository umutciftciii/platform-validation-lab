// Captures the application cards at their settled positions, for image reviews.
// Usage: node cards.mjs <base-url> <output-dir> <prefix>
import { chromium } from "playwright-core";
import path from "node:path";
import fs from "node:fs";
const [base = "http://localhost:3110", dir = "../kart-gorselleri", prefix = "sonra"] = process.argv.slice(2);
const TARGETS = ["Passenger", "Transmission", "Hydraulic", "Compressor", "Industrial", "Specialty"];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const url = `${base}/demo/iccsyn-hero`;
const report = {};

// A card is judged by its own computed opacity and its on-screen rectangle.
const state = (page, title) => page.evaluate((title) => {
  const h = [...document.querySelectorAll(".plate-title")].find((n) => n.textContent.startsWith(title));
  const plate = h.closest(".glass-plate");
  let opacity = 1;
  for (let n = plate; n && n !== document.body; n = n.parentElement) opacity *= +getComputedStyle(n).opacity;
  const r = plate.getBoundingClientRect();
  const img = plate.querySelector("img");
  return { opacity, x: r.x, y: r.y, w: r.width, h: r.height, vh: innerHeight, vw: innerWidth,
    img: { src: img.currentSrc, complete: img.complete, nw: img.naturalWidth, nh: img.naturalHeight } };
}, title);

async function open(viewport, options = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, ...options });
  const page = await context.newPage();
  const failures = [];
  page.on("response", (r) => { if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error") failures.push(m.text()); });
  await page.goto(url, { waitUntil: "networkidle" });
  const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  return { context, page, failures, range };
}
const go = async (page, y, ms = 1500) => { await page.evaluate((y) => { document.documentElement.scrollTop = y; }, y); await page.waitForTimeout(ms); };

// Desktop: every card settled.
{
  const { context, page, failures, range } = await open({ width: 1440, height: 900 });
  await go(page, range * 0.72);
  await page.screenshot({ path: path.join(dir, `${prefix}-masaustu-1440.png`) });
  report.desktop = {};
  for (const t of TARGETS) report.desktop[t] = await state(page, t);
  // Hover on the first card that was replaced.
  const c = report.desktop.Passenger;
  await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dir, `${prefix}-masaustu-hover.png`) });
  report.desktopFailures = failures;
  await context.close();
}

// Mobile: find the scroll position where each card sits best in the deck.
{
  const { context, page, failures, range } = await open({ width: 375, height: 812 });
  report.mobile = {};
  for (const t of TARGETS) {
    let best = null;
    for (let p = 0.1; p <= 0.8; p += 0.01) {
      await go(page, range * p, 90);
      const s = await state(page, t);
      const dist = Math.abs(s.y + s.h / 2 - s.vh / 2);
      const score = s.opacity * 1000 - dist;
      if (!best || score > best.score) best = { score, p };
    }
    await go(page, range * best.p, 1200);
    report.mobile[t] = { p: +best.p.toFixed(2), ...(await state(page, t)) };
    await page.screenshot({ path: path.join(dir, `${prefix}-mobil-375-${t.toLowerCase()}.png`) });
  }
  report.mobileFailures = failures;
  await context.close();
}

// Reduced motion renders the static layout.
{
  const { context, page, failures } = await open({ width: 1440, height: 900 }, { reducedMotion: "reduce" });
  await page.screenshot({ path: path.join(dir, `${prefix}-reduced-motion.png`), fullPage: true });
  report.reducedFailures = failures;
  await context.close();
}
await browser.close();
fs.writeFileSync(path.join(dir, `${prefix}-olcum.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ d: report.desktopFailures, m: report.mobileFailures, r: report.reducedFailures, mobileP: Object.fromEntries(TARGETS.map((t) => [t, [report.mobile[t].p, +report.mobile[t].opacity.toFixed(2), Math.round(report.mobile[t].y)]])) }));
