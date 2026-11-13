// Real wheel gestures, parallax check and stills at set scroll percentages.
// Usage: node wheel-and-stills.mjs <url> <output-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
const [url = "http://localhost:3110/demo/iccsyn-hero", dir = "../zamanlama"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const out = {};
const state = () => {
  const section = document.querySelector("section");
  const lis = [...document.querySelectorAll(".glass-plate")].map((p) => p.parentElement);
  const v = document.querySelector(".vessel-mask").getBoundingClientRect();
  return {
    pct: +((100 * scrollY) / (section.offsetHeight - innerHeight)).toFixed(1),
    vessel: +(+getComputedStyle(document.querySelector(".vessel-mask").parentElement).opacity).toFixed(2),
    cards: lis.map((li) => { const r = li.getBoundingClientRect(); const cx = r.left + r.width / 2; return { op: +(+getComputedStyle(li).opacity).toFixed(2), clearOfVessel: cx < v.left || cx > v.right }; }).filter((c) => c.op > 0.05).length,
    cardsOpaque: lis.filter((li) => +getComputedStyle(li).opacity > 0.6).length,
    cardsCentreOutsideVessel: lis.filter((li) => { const r = li.getBoundingClientRect(); const cx = r.left + r.width / 2; return +getComputedStyle(li).opacity > 0.3 && (cx < v.left + v.width * 0.15 || cx > v.right - v.width * 0.15); }).length,
  };
};
for (const [name, viewport] of [["1440x900", { width: 1440, height: 900 }], ["1920x1080", { width: 1920, height: 1080 }]]) {
  for (const [label, deltas, gap] of [
    ["tek klik (100 px)", [100], 0],
    ["iki klik (200 px)", [100, 100], 90],
    ["üç klik, tek hareket (300 px)", [100, 100, 100], 90],
    ["trackpad kısa hareket (240 px)", Array(24).fill(10), 12],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    for (const d of deltas) { await page.mouse.wheel(0, d); if (gap) await page.waitForTimeout(gap); }
    await page.waitForTimeout(900);
    (out[name] ??= {})[label] = await page.evaluate(state);
    await context.close();
  }
}
// Hover and pointer parallax at the end of the hero
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => { document.documentElement.scrollTop = document.querySelector("section").offsetHeight - innerHeight; });
  await page.waitForTimeout(1500);
  const scene = () => document.querySelector('[style*="preserve-3d"]').style.transform;
  await page.mouse.move(720, 450, { steps: 3 }); await page.waitForTimeout(1200);
  const mid = await page.evaluate(scene);
  await page.mouse.move(1400, 60, { steps: 6 }); await page.waitForTimeout(1500);
  const corner = await page.evaluate(scene);
  const box = await page.locator(".glass-plate").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 }); await page.waitForTimeout(900);
  const hover = await page.evaluate(() => { const p = [...document.querySelectorAll(".glass-plate")]; return { active: p[0].dataset.active, others: getComputedStyle(p[1]).opacity, rotateY: /rotateY\(([^)]+)\)/.exec(p[0].parentElement.style.transform)?.[1] }; });
  out.parallax = { centre: mid, corner, moved: mid !== corner };
  out.hover = hover;
  await context.close();
}
// Stills
for (const [name, viewport] of [["masaustu-1440", { width: 1440, height: 900 }], ["mobil-375", { width: 375, height: 812 }]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const travel = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  for (const pct of [0, 15, 30, 50, 80]) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, (travel * pct) / 100);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(dir, `${name}-${String(pct).padStart(2, "0")}.png`) });
  }
  await context.close();
}
fs.writeFileSync(path.join(dir, "wheel-testi.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
