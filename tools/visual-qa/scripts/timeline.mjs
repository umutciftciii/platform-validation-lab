// Measures the scroll timeline with real wheel input.
// Usage: node timeline.mjs <url> <output.json> [sectionHeightOverrideSvh]
import { chromium } from "playwright-core";
import fs from "node:fs";
const [url = "http://localhost:3110/demo/iccsyn-hero", out = "timeline.json", override] = process.argv.slice(2);
const viewports = [[1440, 900], [1920, 1080], [1280, 720], [375, 812]];
const NOTCH = 100; // Chrome's usual delta for one mouse-wheel click

const measure = () => {
  const mask = document.querySelector(".vessel-mask");
  const v = mask.getBoundingClientRect();
  const vOp = +getComputedStyle(mask.parentElement).opacity;
  const alpha = (x, y) => { const d = Math.hypot((x - (v.left + v.width / 2)) / (v.width / 2), (y - (v.top + v.height / 2)) / (v.height / 2)); return d <= 0.62 ? 1 : d >= 1 ? 0 : (1 - d) / 0.38; };
  const cards = [...document.querySelectorAll(".glass-plate")].map((p) => {
    const li = p.parentElement, r = p.getBoundingClientRect(), op = +getComputedStyle(li).opacity;
    const z = +(/translate3d\(.*,\s*(-?[\d.]+)px\)\s*rotateX/.exec(li.style.transform)?.[1] ?? 0);
    // Share of the card a viewer can actually see: fade, and glass in front of it.
    let seen = 0, total = 0;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 6; j++) {
      const x = r.left + (r.width * i) / 10, y = r.top + (r.height * j) / 6;
      const blocked = z < 0 ? alpha(x, y) * vOp : 0;
      total++; if (op * (1 - blocked) >= 0.35 && x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight) seen++;
    }
    return { op, seen: seen / total };
  });
  const chars = [...document.querySelectorAll("h1 [aria-hidden] .whitespace-nowrap > span")];
  const letters = chars.filter((c) => +getComputedStyle(c).opacity > 0.5).length;
  const canvas = document.querySelector("canvas"); let frame = null;
  try { frame = canvas.getContext("2d").getImageData(canvas.width * 0.55, canvas.height * 0.72, 30, 30).data.reduce((a, b) => a + b, 0); } catch {}
  const section = document.querySelector("section");
  return {
    y: Math.round(scrollY), pct: +((100 * scrollY) / (section.offsetHeight - innerHeight)).toFixed(1),
    letters, of: chars.length, vessel: +vOp.toFixed(2), frame,
    cardsSeen: cards.filter((c) => c.seen >= 0.25).length, cardsFull: cards.filter((c) => c.op > 0.98 && c.seen > 0.9).length,
    cta: +(+getComputedStyle(document.querySelector(".hero-cta").parentElement).opacity).toFixed(2),
  };
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {};
for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (override) await page.evaluate((h) => { document.querySelector("section").style.height = `${h}svh`; window.dispatchEvent(new Event("resize")); }, override);
  await page.waitForTimeout(400);
  await page.mouse.move(width / 2, height / 2);
  const travel = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  const notches = [];
  for (let i = 1; i <= 80; i++) {
    await page.mouse.wheel(0, NOTCH);
    await page.waitForTimeout(850);
    const m = await page.evaluate(measure);
    notches.push({ notch: i, ...m });
    if (m.pct >= 100) break;
  }
  const first = (fn) => notches.find(fn)?.notch ?? null;
  // Fine-grained pass for the empty stage: glass alone on screen.
  const fine = [];
  for (let f = 0; f <= 1.0001; f += 0.02) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, travel * f);
    await page.waitForTimeout(600);
    fine.push(await page.evaluate(measure));
  }
  const alone = fine.filter((m) => m.vessel > 0.5 && m.letters === 0 && m.cardsSeen === 0 && m.cta < 0.3);
  const frames = new Set(fine.map((m) => m.frame)).size;
  report[`${width}x${height}`] = {
    travelPx: travel, travelScreens: +(travel / height).toFixed(2), pctPerNotch: +((100 * NOTCH) / travel).toFixed(1),
    firstCardNotch: first((m) => m.cardsSeen >= 1), twoCardsNotch: first((m) => m.cardsSeen >= 2), allCardsNotch: first((m) => m.cardsFull >= (width < 768 ? 0 : 6) && m.cta > 0), ctaFullNotch: first((m) => m.cta >= 0.98), totalNotches: notches.length,
    glassAlonePctOfTravel: Math.round((alone.length / fine.length) * 100), distinctFrames: frames,
    notches: notches.slice(0, 6), fine,
  };
  const r = report[`${width}x${height}`];
  console.log(`${width}x${height}`, JSON.stringify({ travelPx: r.travelPx, pctPerNotch: r.pctPerNotch, firstCard: r.firstCardNotch, twoCards: r.twoCardsNotch, cta: r.ctaFullNotch, total: r.totalNotches, glassAlonePct: r.glassAlonePctOfTravel, frames: r.distinctFrames }));
  console.log("   notch:", r.notches.slice(0, 4).map((n) => `${n.notch}→${n.pct}% letters=${n.letters}/${n.of} vessel=${n.vessel} cards=${n.cardsSeen}`).join(" | "));
  await context.close();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
await browser.close();
