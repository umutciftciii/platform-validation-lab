// Takes the same stills for a before/after comparison.
// Usage: node stills.mjs <base-url> <output-dir> <prefix>
import { chromium } from "playwright-core";
import path from "node:path";
const [base = "http://localhost:3110", dir = "../once-sonra", prefix = "sonra"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const main = `${base}/demo/iccsyn-hero`;
const fraction = (p) => p;

for (const [name, viewport, stages] of [
  ["desktop", { width: 1440, height: 900 }, [["baslangic", 0], ["metin", 0.1], ["kap", 0.21], ["kartlar", 0.58], ["final", 1]]],
  ["mobil", { width: 390, height: 844 }, [["baslangic", 0], ["kap", 0.17], ["kart-1", 0.25], ["kart-4", 0.57], ["final", 1]]],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(main, { waitUntil: "networkidle" });
  const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  for (const [stage, p] of stages) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, range * fraction(p));
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(dir, `${prefix}-${name}-${stage}.png`) });
  }
  await context.close();
}
const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
const page = await reduced.newPage();
await page.goto(main, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(dir, `${prefix}-reduced-motion.png`), fullPage: true });
await browser.close();
