// Records every scroll movement on the hero and what, if anything, caused it.
// Usage: node scroll-trace.mjs <base-url> <output.json>
import { chromium } from "playwright-core";
import fs from "node:fs";

const [base = "http://localhost:3110", out = "scroll-trace.json"] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero`;

const instrument = () => {
  const log = (window.__log = []);
  const note = (type, detail = "") =>
    log.push({ t: Math.round(performance.now()), y: Math.round(scrollY), type, detail });
  window.__note = note;
  for (const name of ["scrollTo", "scrollBy", "scroll"]) {
    const original = window[name];
    window[name] = function (...args) {
      note(`api:${name}`, JSON.stringify(args) + " " + (new Error().stack || "").split("\n")[2]?.trim().slice(0, 90));
      return original.apply(this, args);
    };
  }
  const siv = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (...a) { note("api:scrollIntoView", this.tagName); return siv.apply(this, a); };
  for (const type of ["wheel", "keydown", "touchmove"]) addEventListener(type, (e) => note(`input:${type}`, e.key || `${e.deltaY ?? ""}`), { capture: true, passive: true });
  addEventListener("focusin", (e) => note("focusin", `${e.target.tagName} ${e.target.innerText?.slice(0, 18)} focus-visible=${e.target.matches(":focus-visible")}`), true);
  addEventListener("blur", () => note("window:blur"));
  addEventListener("focus", () => note("window:focus"));
  addEventListener("resize", () => note("window:resize", `${innerWidth}x${innerHeight}`));
  let last = null;
  const onScroll = () => { if (last !== null && scrollY !== last) log.push({ t: Math.round(performance.now()), y: Math.round(scrollY), type: "scroll", delta: Math.round(scrollY - last) }); last = scrollY; };
  addEventListener("scroll", onScroll, { passive: true });
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = {};

async function scenario(name, fn, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await fn(page, context);
  const log = await page.evaluate(() => window.__log);
  const scrolls = log.filter((e) => e.type === "scroll");
  const upward = scrolls.filter((e) => e.delta < 0);
  // An upward move with no user input and no API call in the prior 800 ms is unexplained.
  const causes = log.filter((e) => e.type.startsWith("input:") || e.type.startsWith("api:"));
  const unexplained = upward.filter((u) => !causes.some((c) => c.t <= u.t && u.t - c.t < 800));
  results[name] = {
    finalY: await page.evaluate(() => Math.round(scrollY)),
    scrollEvents: scrolls.length,
    upwardEvents: upward.length,
    upwardPx: upward.reduce((a, e) => a + e.delta, 0),
    unexplainedUpward: unexplained.length,
    apiCalls: log.filter((e) => e.type.startsWith("api:")).map((e) => `${e.t} ${e.type} y=${e.y} ${e.detail}`),
    focus: log.filter((e) => e.type === "focusin" || e.type.startsWith("window:")).map((e) => `${e.t} ${e.type} ${e.detail} y=${e.y}`),
  };
  console.log(name, JSON.stringify({ final: results[name].finalY, up: results[name].upwardEvents, upPx: results[name].upwardPx, unexplained: results[name].unexplainedUpward, api: results[name].apiCalls.length }));
  await context.close();
}

const range = (page) => page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
const direct = (page, y) => page.evaluate((v) => { document.documentElement.scrollTop = v; }, y);

await scenario("A idle at 5 positions, 4s each, no input", async (page) => {
  const h = await range(page);
  for (const f of [0.25, 0.5, 0.75, 1, 1.08]) { await direct(page, h * f); await page.waitForTimeout(4000); }
});

await scenario("B jump to section end straight after load, watch 10s", async (page) => {
  await direct(page, await range(page));
  await page.waitForTimeout(10000);
});

await scenario("C wheel down in notches, stop, watch 5s", async (page) => {
  await page.mouse.move(720, 450);
  for (let i = 0; i < 34; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(60); }
  await page.waitForTimeout(5000);
});

await scenario("D wheel at the bottom edge of the hero, then release", async (page) => {
  await page.mouse.move(720, 450);
  const h = await range(page);
  await direct(page, h - 200);
  await page.waitForTimeout(500);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(4000);
});

await scenario("E hover cards at end, sweep pointer, 5s", async (page) => {
  await direct(page, await range(page));
  await page.waitForTimeout(2000);
  for (const [x, y] of [[300, 240], [1200, 240], [300, 480], [1200, 480], [300, 700], [1150, 700], [720, 50]]) { await page.mouse.move(x, y, { steps: 8 }); await page.waitForTimeout(500); }
  await page.waitForTimeout(1500);
});

await scenario("F tab to a card, then wheel away past it", async (page) => {
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.waitForTimeout(2500);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(60); }
  await page.waitForTimeout(3000);
});

await scenario("G tab to a card, wheel away, leave the tab and return", async (page, context) => {
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.waitForTimeout(2500);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => Math.round(scrollY));
  const other = await context.newPage();
  await other.goto("about:blank"); await other.waitForTimeout(600);
  await page.bringToFront();
  await page.evaluate(() => { window.__note("window:simulated-return"); const el = document.activeElement; el.blur(); el.focus({ preventScroll: true }); }); // A window return does not scroll; a plain focus() would.
  await page.waitForTimeout(3000);
  results.__G_before = before;
});

await scenario("H wheel while a keyboard-triggered smooth scroll is running", async (page) => {
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  await page.mouse.move(720, 450);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(80); }
  await page.waitForTimeout(3000);
});

await scenario("I reload in the middle of the hero", async (page) => {
  await direct(page, 2000);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(4000);
});

await scenario("J resize across the mobile breakpoint mid-hero", async (page) => {
  await direct(page, 2000);
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2000);
});

await scenario("K mobile: flick, stop, watch 5s", async (page) => {
  await page.mouse.move(180, 400);
  for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 140); await page.waitForTimeout(40); }
  await page.waitForTimeout(5000);
}, { width: 375, height: 812 });

fs.writeFileSync(out, JSON.stringify(results, null, 2));
await browser.close();
