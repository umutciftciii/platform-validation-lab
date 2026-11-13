// Samples the whole scroll range at several screen sizes and reports overlaps
// between cards, the visible glass, the call to action and the screen edge.
// Usage: node occlusion.mjs <url> <output.json>
import { chromium } from "playwright-core";
import fs from "node:fs";

const [url = "http://localhost:3110/demo/iccsyn-hero", out = "occlusion.json"] = process.argv.slice(2);
const viewports = [[1920, 1080], [1440, 900], [1280, 720], [1280, 620], [1024, 768], [768, 1024], [844, 390], [375, 812]];

const measure = () => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
  const vessel = rect(document.querySelector(".vessel-mask"));
  const vesselOpacity = +getComputedStyle(document.querySelector(".vessel-mask").parentElement).opacity;
  const w = vessel.r - vessel.l, h = vessel.b - vessel.t;
  // Mask from globals.css: opaque to 62% of the ellipse radius, clear at 100%.
  const alpha = (x, y) => {
    const d = Math.hypot((x - (vessel.l + w / 2)) / (w / 2), (y - (vessel.t + h / 2)) / (h / 2));
    return d <= 0.62 ? 1 : d >= 1 ? 0 : (1 - d) / 0.38;
  };
  // Where the beaker and the stream sit inside the footage's square crop.
  const inGlass = (x, y) => { const u = (x - vessel.l) / w, v = (y - vessel.t) / h; return (u > 0.08 && u < 0.79 && v > 0.53 && v < 1) || (u > 0.45 && u < 1 && v > 0 && v < 0.53); };
  const plates = [...document.querySelectorAll(".glass-plate")];
  const cards = plates.map((p) => {
    const li = p.parentElement, r = rect(p);
    const z = +(/translate3d\(.*,\s*(-?[\d.]+)px\)\s*rotateX/.exec(li.style.transform)?.[1] ?? 0);
    let maxVesselAlpha = 0, glassPoints = 0, total = 0;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
      const x = r.l + ((r.r - r.l) * i) / 12, y = r.t + ((r.b - r.t) * j) / 8;
      total++;
      const a = alpha(x, y);
      if (a > maxVesselAlpha) maxVesselAlpha = a;
      if (a > 0.3 && inGlass(x, y)) glassPoints++;
    }
    return { title: p.querySelector("h2").innerText.slice(0, 22), rect: r, z, opacity: +getComputedStyle(li).opacity, maxVesselAlpha, glassShare: glassPoints / total };
  });
  const ctaBox = document.querySelector(".hero-cta").parentElement;
  // The wrapper spans the full width, so measure what is actually drawn inside it.
  const ctaItems = [...ctaBox.children].map((el) => rect(el));
  return { y: scrollY, vesselOpacity, vessel, cards, cta: { items: ctaItems, opacity: +getComputedStyle(ctaBox).opacity }, vw: innerWidth, vh: innerHeight };
};

const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const size = (r) => (r.r - r.l) * (r.b - r.t);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {};

for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
  const findings = { cardCard: [], cardGlass: [], cardInFrontOfGlass: [], cardCta: [], offscreen: [] };
  const seen = new Set();
  const add = (list, key, entry) => { if (!seen.has(key)) { seen.add(key); list.push(entry); } else { const e = list.find((x) => x.key === key); if (e && entry.share > e.share) Object.assign(e, entry); } };
  for (let f = 0; f <= 1.0001; f += 0.03) {
    await page.evaluate((y) => { document.documentElement.scrollTop = y; }, range * f);
    await page.waitForTimeout(650);
    const m = await page.evaluate(measure);
    const at = +f.toFixed(2);
    const visible = m.cards.filter((c) => c.opacity > 0.5);
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const settled = c.opacity > 0.98;
      if (c.glassShare > 0.01) add(findings.cardGlass, `g${c.title}`, { key: `g${c.title}`, card: c.title, at, share: +c.glassShare.toFixed(3), behind: c.z < 0, opacity: +c.opacity.toFixed(2) });
      if (c.glassShare > 0.01 && c.z >= 0) add(findings.cardInFrontOfGlass, `f${c.title}`, { key: `f${c.title}`, card: c.title, at, share: +c.glassShare.toFixed(3), z: Math.round(c.z), opacity: +c.opacity.toFixed(2) });
      if (m.cta.opacity > 0.3) {
        const share = Math.max(...m.cta.items.map((item) => area(c.rect, item) / size(c.rect)));
        if (share > 0.005) add(findings.cardCta, `c${c.title}`, { key: `c${c.title}`, card: c.title, at, share: +share.toFixed(3) });
      }
      const outside = Math.max(0, -c.rect.l, c.rect.r - m.vw, -c.rect.t, c.rect.b - m.vh);
      if (outside > 0 && settled) add(findings.offscreen, `o${c.title}`, { key: `o${c.title}`, card: c.title, at, share: Math.round(outside), px: Math.round(outside) });
      for (let j = i + 1; j < visible.length; j++) {
        const d = visible[j];
        const share = area(c.rect, d.rect) / Math.min(size(c.rect), size(d.rect));
        if (share > 0.01) add(findings.cardCard, `p${c.title}${d.title}`, { key: `p${c.title}${d.title}`, cards: [c.title, d.title], at, share: +share.toFixed(3), opacities: [+c.opacity.toFixed(2), +d.opacity.toFixed(2)] });
      }
    }
  }
  // Final frame: the state a reader rests on.
  await page.evaluate((y) => { document.documentElement.scrollTop = y; }, range);
  await page.waitForTimeout(2000);
  const end = await page.evaluate(measure);
  const shown = end.cards.filter((c) => c.opacity > 0.5);
  const pairs = [];
  shown.forEach((c, i) => shown.slice(i + 1).forEach((d) => { const share = area(c.rect, d.rect) / Math.min(size(c.rect), size(d.rect)); if (share > 0) pairs.push([c.title, d.title, +share.toFixed(3)]); }));
  report[`${width}x${height}`] = {
    ...findings,
    final: {
      cardsShown: shown.length,
      cardGlass: shown.filter((c) => c.glassShare > 0).map((c) => [c.title, +c.glassShare.toFixed(3), c.z < 0 ? "behind" : "front"]),
      cardCard: pairs,
      cardCta: shown.filter((c) => end.cta.items.some((item) => area(c.rect, item) > 0)).map((c) => c.title),
      ctaButtonTop: Math.round(end.cta.items[0].t),
      vesselBottom: Math.round(end.vessel.b),
      minGapCardToCta: shown.length ? Math.round(Math.min(...shown.flatMap((c) => end.cta.items.map((item) => Math.max(item.l - c.rect.r, c.rect.l - item.r, item.t - c.rect.b, c.rect.t - item.b))))) : null,
    },
  };
  const r = report[`${width}x${height}`];
  for (const k of Object.keys(findings)) r[k].forEach((e) => delete e.key);
  console.log(`${width}x${height}`, JSON.stringify({ transit: { cardCard: r.cardCard.length, behindGlass: r.cardGlass.length, inFrontOfGlass: r.cardInFrontOfGlass, cardCta: r.cardCta, offscreen: r.offscreen }, final: r.final }));
  await context.close();
}
fs.writeFileSync(out, JSON.stringify(report, null, 2));
await browser.close();
