// Confirms the animation still behaves as before the photo cards.
// Usage: node regression.mjs <base-url> <output.json>
import { chromium } from "playwright-core";
import fs from "node:fs";
const [base = "http://localhost:3110", out = "../regresyon.json"] = process.argv.slice(2);
const main = `${base}/demo/iccsyn-hero`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const result = {};

const snapshot = () => {
  const chars = [...document.querySelectorAll("h1 span[aria-hidden] span.inline-block > span.inline-block, h1 span[aria-hidden] .inline-block.whitespace-nowrap > span")];
  const canvas = document.querySelector("canvas");
  let sample = null;
  try { const c = canvas.getContext("2d"); const d = c.getImageData(canvas.width * 0.55, canvas.height * 0.72, 40, 40).data; sample = d.reduce((a, v) => a + v, 0); } catch {}
  const vessel = document.querySelector(".vessel-mask").parentElement;
  const opacity = (el) => +(+getComputedStyle(el).opacity).toFixed(2);
  return {
    y: Math.round(scrollY),
    titleLettersVisible: chars.filter((c) => opacity(c) > 0.5).length,
    titleLetters: chars.length,
    vesselOpacity: opacity(vessel),
    canvasSample: sample,
    cardsVisible: [...document.querySelectorAll(".glass-plate")].filter((p) => opacity(p.parentElement) > 0.5).length,
    ctaOpacity: opacity(document.querySelector(".hero-cta").parentElement),
    sticky: Math.round(document.querySelector(".sticky").getBoundingClientRect().top),
  };
};

// Timeline and image readiness at desktop
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const images = [];
  page.on("response", async (r) => { if (r.url().includes("iccsyn-cards")) images.push({ url: decodeURIComponent(r.url()).split("url=")[1]?.split("&")[0], w: /w=(\d+)/.exec(r.url())?.[1], type: r.headers()["content-type"], kb: Math.round(((await r.body().catch(() => Buffer.alloc(0))).length) / 1024) }); });
  await page.goto(main, { waitUntil: "networkidle" });
  result.cardImagesBeforeScroll = await page.evaluate(() => [...document.querySelectorAll(".plate-image")].map((i) => ({ complete: i.complete, width: i.naturalWidth })));
  result.cardImageRequests = images;
  const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  const timeline = {};
  for (const [name, f] of [["0 start", 0], ["0.14 dissolve", 0.14], ["0.25 vessel", 0.25], ["0.55 cards", 0.55], ["1 final", 1]]) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, range * f);
    await page.waitForTimeout(1600);
    timeline[name] = await page.evaluate(snapshot);
  }
  result.timeline = timeline;

  // Hover: the card turns to face the viewer, its neighbours dim, its photo scales
  const plate = page.locator(".glass-plate").first();
  const box = await plate.boundingBox();
  const before = await page.evaluate(() => document.querySelector(".glass-plate").parentElement.style.transform);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(900);
  result.hover = await page.evaluate((b) => {
    const plates = [...document.querySelectorAll(".glass-plate")];
    const t = plates[0].parentElement.style.transform;
    return { active: plates[0].dataset.active, otherOpacity: getComputedStyle(plates[1]).opacity, rotationChanged: t !== b, rotateY: /rotateY\(([^)]+)\)/.exec(t)?.[1], imageScale: getComputedStyle(plates[0].querySelector(".plate-image")).transform };
  }, before);
  await context.close();
}

// Keyboard order and reveal
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(main, { waitUntil: "networkidle" });
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1500);
    order.push(await page.evaluate(() => { const a = document.activeElement; const li = a.closest("li"); return { text: (a.querySelector?.("h2")?.innerText || a.innerText).slice(0, 28), visible: li ? +getComputedStyle(li).opacity > 0.5 : true, y: Math.round(scrollY) }; }));
  }
  result.keyboard = order;
  await context.close();
}

// Performance while scrolling, desktop and an emulated phone
for (const [name, options] of [["desktop", { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 }], ["mobile", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }]]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(main, { waitUntil: "networkidle" });
  result[`perf_${name}`] = await page.evaluate(async () => {
    const range = document.querySelector("section").offsetHeight - innerHeight;
    const d = []; let last = performance.now(); const t0 = last;
    await new Promise((res) => { const tick = (t) => { d.push(t - last); last = t; const f = (t - t0) / 5000; document.documentElement.scrollTop = range * Math.min(1, f); if (f < 1) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    d.shift(); d.sort((a, b) => a - b);
    const entries = performance.getEntriesByType("resource");
    const kb = (fn) => Math.round(entries.filter(fn).reduce((a, e) => a + e.transferSize, 0) / 1024);
    return { frames: d.length, medianMs: +d[d.length >> 1].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1), maxMs: +d[d.length - 1].toFixed(1), over33ms: d.filter((x) => x > 33.4).length, cardImagesKB: kb((e) => e.name.includes("iccsyn-cards")), vesselFramesKB: kb((e) => /\/(desktop|mobile)\/\d+\.webp/.test(e.name)), jsKB: kb((e) => e.name.endsWith(".js")), cardImageCount: entries.filter((e) => e.name.includes("iccsyn-cards")).length };
  });
  await context.close();
}
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
await browser.close();
