// Finds title letters drawn over a card, frame by frame through the title's range.
// Usage: node title-overlap.mjs <url> <output.json> <still-prefix> [WxH ...]
import { chromium } from "playwright-core";
import fs from "node:fs";
const [url = "http://localhost:3110/demo/iccsyn-hero", out = "overlap.json", prefix, ...sizes] = process.argv.slice(2);
const viewports = (sizes.length ? sizes : ["1440x900", "375x812"]).map((s) => s.split("x").map(Number));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const measure = () => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const cards = [...document.querySelectorAll(".glass-plate")].map((p) => ({ title: p.querySelector("h2").innerText.slice(0, 12), op: +getComputedStyle(p.parentElement).opacity, rect: box(p) })).filter((c) => c.op > 0.04);
  const letters = (selector, line) => [...document.querySelectorAll(selector)].map((s) => ({ line, ch: s.textContent, op: +getComputedStyle(s).opacity, rect: box(s) })).filter((l) => l.op > 0.04);
  const all = [...letters("h1 [aria-hidden] .whitespace-nowrap > span", "brand"), ...letters(".hero-tagline [aria-hidden] .whitespace-nowrap > span", "tagline")];
  const hits = [];
  for (const l of all) for (const c of cards) if (hit(l.rect, c.rect)) hits.push({ line: l.line, ch: l.ch, letterOp: +l.op.toFixed(2), card: c.title, cardOp: +c.op.toFixed(2), gapPx: 0 });
  const tag = letters(".hero-tagline [aria-hidden] .whitespace-nowrap > span", "tagline");
  const firstCard = cards[0];
  return { letters: all.length, cards: cards.length, hits, pairs: hits.length, worst: hits.reduce((a, h) => Math.max(a, Math.min(h.letterOp, h.cardOp)), 0), tagBottom: tag.length ? Math.round(Math.max(...tag.map((t) => t.rect.b))) : null, cardTop: firstCard ? Math.round(firstCard.rect.t) : null };
};
const report = {};
for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const travel = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  const rows = {};
  for (let pct = 6; pct <= 30; pct += 1) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, (travel * pct) / 100);
    await page.waitForTimeout(650);
    const m = await page.evaluate(measure);
    rows[pct] = m;
    if (prefix && [12, 15, 18, 20, 25].includes(pct)) await page.screenshot({ path: `${prefix}-${width}-${String(pct).padStart(2, "0")}.png` });
  }
  const dirty = Object.entries(rows).filter(([, m]) => m.pairs > 0);
  report[`${width}x${height}`] = { framesWithOverlap: dirty.length, framesChecked: Object.keys(rows).length, totalPairs: dirty.reduce((a, [, m]) => a + m.pairs, 0), worstVisibility: dirty.reduce((a, [, m]) => Math.max(a, m.worst), 0), range: dirty.length ? [dirty[0][0], dirty.at(-1)[0]] : null, rows };
  const r = report[`${width}x${height}`];
  console.log(`${width}x${height}`, JSON.stringify({ frames: `${r.framesWithOverlap}/${r.framesChecked}`, pairs: r.totalPairs, worst: r.worstVisibility, range: r.range }));
  console.log("  ", dirty.map(([p, m]) => `%${p}:${m.pairs}(${m.worst})`).join(" "));
  console.log("   letters left:", Object.entries(rows).map(([p, m]) => `${p}:${m.letters}`).join(" "));
  await context.close();
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
await browser.close();
