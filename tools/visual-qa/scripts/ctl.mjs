// Scroll, accessibility and performance checks for the CTL section.
// Usage: node ctl.mjs <base-url> <out-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base = "http://localhost:3110", out = "."] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [], perf = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 320)); };

async function open({ width, height, touch = false, reduced = false, js = true }) {
  const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? "reduce" : "no-preference", javaScriptEnabled: js });
  const p = await c.newPage();
  p.errors = []; p.bad = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text().slice(0, 300)); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) p.bad.push(`${r.status()} ${r.url()}`); });
  await p.route("**://dreampetroleumbv.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
  await p.goto(url, { waitUntil: "load" });
  if (js) await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return p;
}
const toP = async (p, f, wait = 1800) => { await p.evaluate((f) => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + f * (s.offsetHeight - innerHeight), behavior: "instant" }); }, f); if (wait) await p.waitForTimeout(wait); };
const state = (p) => p.evaluate(() => ({
  images: [...document.querySelectorAll(".ctl-figure")].map((e) => +(+getComputedStyle(e).opacity).toFixed(3)),
  scales: [...document.querySelectorAll(".ctl-image")].map((e) => { const m = getComputedStyle(e).transform; return m === "none" ? 1 : +(+m.match(/matrix\(([^,]+)/)[1]).toFixed(3); }),
  texts: [...document.querySelectorAll(".ctl-text")].map((e) => +(+getComputedStyle(e).opacity).toFixed(3)),
  current: [...document.querySelectorAll(".ctl-nav-item")].findIndex((e) => e.getAttribute("aria-current") === "step"),
  stickyTop: document.querySelector(".ctl-sticky").getBoundingClientRect().top,
}));

// Cinematic ------------------------------------------------------------------------
for (const [name, width, height] of [["1440x900", 1440, 900], ["1920x1080", 1920, 1080]]) {
  const p = await open({ width, height });
  await toP(p, 0, 400);
  await p.waitForFunction(() => [...document.querySelectorAll(".ctl-image")].every((i) => i.complete && i.naturalWidth > 0));
  const m = await p.evaluate(() => ({ h: document.querySelector("#ctl-technology").offsetHeight / innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, pos: getComputedStyle(document.querySelector(".ctl-sticky")).position }));
  check(`${name}: sticky stage, 3.4 screens long, no sideways overflow`, m.pos === "sticky" && Math.abs(m.h - 3.4) < 0.01 && m.overflow <= 0, m);

  for (const [f, stage] of [[0.14, 0], [0.52, 1], [0.9, 2]]) {
    await toP(p, f);
    const s = await state(p);
    check(`${name}: at ${f} only stage ${stage + 1} is on screen, buttons agree`, s.images.every((o, i) => (i === stage ? o === 1 : o === 0)) && s.texts.every((o, i) => (i === stage ? o === 1 : o === 0)) && s.current === stage && s.stickyTop === 0, s);
    // Contrast against the brightest pixel behind the text, image included.
    await p.addStyleTag({ content: ".ctl-hide .ctl-text *, .ctl-hide .ctl-head *, .ctl-hide .ctl-nav-item, .ctl-hide .ctl-document{color:transparent!important}" });
    const boxes = await p.evaluate((stage) => { const pick = [...document.querySelectorAll(".ctl-text")][stage]; const items = [...pick.querySelectorAll("h3,p")].map((e) => [e, getComputedStyle(e).color]); items.push(...[...document.querySelectorAll(".ctl-eyebrow,.ctl-title,.ctl-document,.ctl-nav-item:not([aria-current])")].map((e) => [e, getComputedStyle(e).color])); return items.flatMap(([e, color]) => { const range = document.createRange(); range.selectNodeContents(e); return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x: r.left, y: r.top, width: r.width, height: r.height, color: color.match(/[\d.]+/g).map(Number), name: e.className || e.tagName })); }); }, stage);
    await p.evaluate(() => document.querySelector("#ctl-technology").classList.add("ctl-hide"));
    await p.waitForTimeout(350);
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    let low = Infinity, lowName = "";
    for (const box of boxes) {
      const png = (await p.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } })).toString("base64");
      const bg = await p.evaluate(async (png) => { const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let best = [0, 0, 0], bl = -1; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (l > bl) { bl = l; best = [d[i], d[i + 1], d[i + 2]]; } } return best; }, png);
      const alpha = box.color[3] ?? 1;
      const fg = box.color.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
      const [a, c] = [lum(fg), lum(bg)];
      const r = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
      if (r < low) { low = r; lowName = box.name; }
    }
    await p.evaluate(() => document.querySelector("#ctl-technology").classList.remove("ctl-hide"));
    check(`${name}: stage ${stage + 1} text contrast >= 4.5:1 on brightest pixel`, low >= 4.5, { low: +low.toFixed(2), lowName });
    await p.waitForTimeout(350);
    await p.addScriptTag({ content: axeSource });
    const axe = await p.evaluate(() => window.axe.run("#ctl-technology", { resultTypes: ["violations"] }));
    check(`${name}: stage ${stage + 1} axe violations`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.length}`));
  }
  check(`${name}: no console errors or failed requests`, !p.errors.length && !p.bad.length, [...p.errors, ...p.bad]);
  await p.context().close();
}

// Handover ---------------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await toP(p, 0, 400);
  const samples = [];
  for (const f of [0.02, 0.1, 0.2, 0.27, 0.3, 0.33, 0.35, 0.37, 0.4, 0.43, 0.5, 0.6, 0.64, 0.67, 0.69, 0.71, 0.74, 0.77, 0.85, 0.98]) { await toP(p, f, 1500); samples.push({ f, ...(await state(p)) }); }
  check("two stages' text is never visible together", samples.every((s) => s.texts.filter((o) => o > 0.001).length <= 1), samples.map((s) => s.texts));
  check("images do crossfade: two visible inside each handover", [0.35, 0.69].every((f) => samples.find((s) => s.f === f).images.filter((o) => o > 0.1).length === 2), [samples.find((s) => s.f === 0.35).images, samples.find((s) => s.f === 0.69).images]);
  const scale0 = samples.filter((s) => s.f <= 0.4).map((s) => s.scales[0]);
  check("first image grows steadily as it leaves", scale0.every((v, i) => i === 0 || v >= scale0[i - 1]), scale0);
  const s1 = samples.filter((s) => s.f >= 0.3 && s.f <= 0.74).map((s) => s.scales[1]);
  check("second image comes from depth, then grows past the viewer", s1[0] < 1.06 && s1.every((v, i) => i === 0 || v >= s1[i - 1]) && s1[s1.length - 1] > 1.1, s1);
  check("button state follows the stage", samples.every((s) => s.current === (s.f < 0.35 ? 0 : s.f < 0.69 ? 1 : 2) || [0.35, 0.69].includes(s.f)), samples.map((s) => s.current));
  check("sticky frame stays pinned through the whole range", samples.every((s) => Math.abs(s.stickyTop) <= 1), samples.map((s) => s.stickyTop));
  await toP(p, 0.52, 1500);
  const there = await state(p);
  await toP(p, 0.14, 1500);
  const back = await state(p);
  check("scrolling back reverses the story", there.current === 1 && back.current === 0 && back.images[0] === 1 && back.images[1] === 0);

  // Normal page scrolling.
  await toP(p, 0.4, 800);
  await p.mouse.move(700, 450);
  const y0 = await p.evaluate(() => scrollY);
  const seen = [];
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(150); seen.push(await p.evaluate(() => scrollY)); }
  check("wheel moves the page by exactly its own distance", seen.every((v, i) => v === y0 + (i + 1) * 120), { y0, seen });
  await toP(p, 1, 300);
  const before = await p.evaluate(() => scrollY);
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(60); }
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ y: scrollY, top: document.querySelector(".ctl-sticky").getBoundingClientRect().top, next: document.querySelector("#ctl-technology").nextElementSibling?.getBoundingClientRect().top }));
  check("scrolling continues past the section into the next one", after.y > before && after.top < 0 && after.next < 900, after);
  await p.evaluate(() => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight / 2, behavior: "instant" }); });
  await p.waitForTimeout(100);
  const w0 = await p.evaluate(() => scrollY);
  await p.mouse.wheel(0, -240); await p.waitForTimeout(250);
  check("scrolling up out of the section into Services still works", (await p.evaluate(() => scrollY)) === w0 - 240);

  // Stage buttons, keyboard and skip link.
  await toP(p, 0.02, 1200);
  await p.locator(".ctl-nav-item").nth(2).click();
  await p.waitForFunction(() => document.querySelectorAll(".ctl-nav-item")[2].getAttribute("aria-current") === "step", null, { timeout: 8000 });
  await p.waitForTimeout(2500);
  const jumped = await state(p);
  check("stage button goes to that stage", jumped.images[2] === 1 && jumped.texts[2] === 1, jumped);
  await p.evaluate(() => { document.querySelector(".sv-arrow:last-child").focus(); });
  const order = [];
  for (let i = 0; i < 6; i++) { await p.keyboard.press("Tab"); await p.waitForTimeout(120); order.push(await p.evaluate(() => { const a = document.activeElement; return a.textContent.trim().slice(0, 30); })); }
  check("Tab order: skip link, three stages, PDF link", order[0] === "Skip the CTL animation" && order[1] === "Industrial Process" && order[3] === "Clear Base Oil" && order[4].startsWith("CTL Technology Overview"), order);
  await p.evaluate(() => document.querySelector("#ctl-technology .skip-link").focus());
  const skipVisible = await p.evaluate(() => { const r = document.querySelector("#ctl-technology .skip-link").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  const skipped = await p.evaluate(() => { const s = document.querySelector("#ctl-technology").getBoundingClientRect(); return { sectionBottom: s.bottom, hash: location.hash }; });
  check("skip link is visible on focus and lands at the section's end", skipVisible && skipped.sectionBottom < 900 && skipped.hash === "#after-ctl-technology", { skipVisible, skipped });
  await p.context().close();
}

// Reload partway down ----------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await toP(p, 0.52, 400);
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(2500);
  const s = await state(p);
  check("reload partway down paints the right stage", s.current === 1 && s.images[1] === 1 && s.texts[1] === 1, s);
  await p.context().close();
}

// Mobile, reduced motion, no script ----------------------------------------------------
{
  const p = await open({ width: 375, height: 812, touch: true });
  await p.evaluate(() => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - 900, behavior: "instant" }); });
  await p.waitForTimeout(500);
  const hidden = await p.evaluate(() => [...document.querySelectorAll(".ctl-stage")].map((s) => [getComputedStyle(s.querySelector(".ctl-text")).opacity, s.dataset.visible]));
  check("375x812: stages wait off screen for their reveal", hidden.every(([o, v]) => o === "0" && v === "false"), hidden);
  const m = await p.evaluate(() => ({ sticky: getComputedStyle(document.querySelector(".ctl-sticky")).position, inline: [...document.querySelectorAll(".ctl-figure,.ctl-text")].filter((e) => e.getAttribute("style")).length, overflow: document.documentElement.scrollWidth - innerWidth, h: document.querySelector("#ctl-technology").offsetHeight, nav: getComputedStyle(document.querySelector(".ctl-nav")).display, will: getComputedStyle(document.querySelector(".ctl-image")).willChange }));
  check("375x812: light layout: no sticky, nothing written on scroll, no overflow", m.sticky === "static" && m.inline === 0 && m.overflow <= 0 && m.nav === "none" && m.will === "auto", m);
  const cdp = await p.context().newCDPSession(p);
  const stageTops = await p.evaluate(() => [...document.querySelectorAll(".ctl-stage")].map((s) => s.getBoundingClientRect().top + scrollY));
  for (const [i, top] of stageTops.entries()) {
    await p.evaluate((t) => window.scrollTo({ top: t - 90, behavior: "instant" }), top);
    await p.waitForTimeout(1200);
    const st = await p.evaluate((i) => { const s = document.querySelectorAll(".ctl-stage")[i]; const t = s.querySelector(".ctl-text"); const img = s.querySelector("img"); return { op: getComputedStyle(t).opacity, tf: getComputedStyle(t).transform, loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc.split("/").pop() }; }, i);
    check(`375x812: stage ${i + 1} revealed, image loaded`, st.op === "1" && st.loaded, st);
  }
  const stay = await p.evaluate(() => [...document.querySelectorAll(".ctl-stage")].map((s) => s.dataset.visible));
  await p.evaluate(() => window.scrollBy({ top: -1000, behavior: "instant" })); await p.waitForTimeout(300);
  check("375x812: a reveal runs only once", stay.every((v) => v === "true") && (await p.evaluate(() => getComputedStyle(document.querySelector(".ctl-stage .ctl-text")).opacity)) === "1");
  const y0 = await p.evaluate(() => scrollY);
  await cdp.send("Input.synthesizeScrollGesture", { x: 180, y: 500, yDistance: -300, speed: 1200, gestureSourceType: "touch" });
  await p.waitForTimeout(300);
  check("375x812: swipe scrolls the page normally", (await p.evaluate(() => scrollY)) > y0);
  await p.addScriptTag({ content: axeSource });
  const axe = await p.evaluate(() => window.axe.run("#ctl-technology", { resultTypes: ["violations"] }));
  check("375x812: axe violations", axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.length}`));
  const targets = await p.evaluate(() => { const r = document.querySelector(".ctl-document").getBoundingClientRect(); return r.height; });
  check("375x812: PDF link is a 44 px target", targets >= 44, targets);
  check("375x812: no console errors or failed requests", !p.errors.length && !p.bad.length, [...p.errors, ...p.bad]);
  await p.context().close();
}
for (const [name, opts] of [["reduced motion 1440x900", { width: 1440, height: 900, reduced: true }], ["reduced motion 375x812", { width: 375, height: 812, touch: true, reduced: true }]]) {
  const p = await open(opts);
  await p.evaluate(() => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY, behavior: "instant" }); });
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => ({ sticky: getComputedStyle(document.querySelector(".ctl-sticky")).position, inline: [...document.querySelectorAll(".ctl-figure,.ctl-text")].filter((e) => e.getAttribute("style")).length, reveal: document.querySelector(".ctl").dataset.reveal, ops: [...document.querySelectorAll(".ctl-figure,.ctl-text")].map((e) => getComputedStyle(e).opacity), transition: getComputedStyle(document.querySelector(".ctl-text")).transitionDuration, nav: getComputedStyle(document.querySelector(".ctl-nav")).display }));
  check(`${name}: stacked with everything visible and no animation`, m.sticky === "static" && m.inline === 0 && m.reveal === "false" && m.ops.every((o) => o === "1") && m.transition === "0s" && m.nav === "none", m);
  await p.addScriptTag({ content: axeSource });
  const axe = await p.evaluate(() => window.axe.run("#ctl-technology", { resultTypes: ["violations"] }));
  check(`${name}: axe violations`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.length}`));
  await p.locator("#ctl-technology").evaluate((e) => e.scrollIntoView({ behavior: "instant" }));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${name.replaceAll(" ", "-").replace("reduced-motion", "azaltilmis-hareket")}.png` });
  await p.context().close();
}
{
  for (const size of [{ width: 375, height: 812, touch: true }, { width: 1440, height: 900 }]) {
    const q = await open({ ...size, js: false });
    const ops = await q.locator(".ctl-figure,.ctl-text").evaluateAll((all) => all.map((e) => getComputedStyle(e).opacity));
    check(`no script ${size.width}x${size.height}: images and text are fully opaque`, ops.length === 6 && ops.every((o) => o === "1"), ops);
    await q.context().close();
  }
  const p = await open({ width: 1440, height: 900, js: false });
  const r = await p.locator(".ctl-stage-title").allTextContents();
  const pos = await p.locator(".ctl-text").first().boundingBox();
  const heights = await p.locator(".ctl-sticky").boundingBox();
  check("no script: stacked, all three stages visible", r.length === 3 && heights.height > 900 && (await p.locator(".ctl-figure").nth(2).isVisible()) && (await p.locator(".ctl-text").nth(2).isVisible()), { r, h: heights.height });
  await p.context().close();
}

// Content rules ----------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  const text = await p.locator("#ctl-technology").evaluate((e) => e.textContent);
  check("no figure anywhere in the visible copy", !/\d/.test(text), text.match(/\d+/g));
  check("Coal-to-Liquid spelled out; each disclosure present", ["Coal-to-Liquid (CTL)", "not a verified CTL plant", "not a reaction diagram", "not a product sample", "colourless", "only reflected light"].every((t) => text.includes(t)));
  const alts = await p.locator(".ctl-image").evaluateAll((e) => e.map((i) => i.alt));
  check("alt text names each image as representative, abstract or illustrative", /^Representative/.test(alts[0]) && /^Abstract/.test(alts[1]) && /^Illustrative/.test(alts[2]) && /colourless/.test(alts[2]), alts);
  check("headings are in order", (await p.locator("#ctl-technology h2").count()) === 1 && (await p.locator("#ctl-technology h3").count()) === 3);
  const order = await p.evaluate(() => [...document.querySelector("main").children].map((e) => e.id || e.className.split(" ")[0]));
  check("section sits right after Services", order[order.indexOf("services") + 1] === "ctl-technology", order);
  const pdf = await p.locator(".ctl-document").getAttribute("href");
  check("PDF link is the site's own file", pdf === "https://dreampetroleumbv.com/assets/specs/iccsyn-ctl-technology-overview.pdf", pdf);
  await p.context().close();
}

// Performance --------------------------------------------------------------------------
async function measure(name, opts, throttle) {
  const p = await open(opts);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Performance.enable");
  await toP(p, 0, 800);
  await p.waitForFunction(() => [...document.querySelectorAll(".ctl-image")].every((i) => i.complete && i.naturalWidth > 0));
  await p.waitForTimeout(800);
  if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await p.evaluate(() => { window.__cls = 0; window.__long = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: false }); new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: false }); });
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  const frames = await p.evaluate(() => new Promise((resolve) => {
    const s = document.querySelector("#ctl-technology");
    const top = s.getBoundingClientRect().top + scrollY;
    const distance = s.offsetHeight - (getComputedStyle(document.querySelector(".ctl-sticky")).position === "sticky" ? innerHeight : 0);
    const start = performance.now(), duration = 6000, deltas = [];
    let last = start;
    const tick = (now) => {
      deltas.push(now - last); last = now;
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo({ top: top + t * distance, behavior: "instant" });
      if (t < 1) requestAnimationFrame(tick); else resolve(deltas.slice(1));
    };
    requestAnimationFrame(tick);
  }));
  const after = await metric();
  const sorted = [...frames].sort((a, c) => a - c);
  const q = (v) => +sorted[Math.floor(sorted.length * v)].toFixed(1);
  const row = { name, throttle, frames: frames.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), over50ms: frames.filter((v) => v > 50).length, fps: +(1000 / (frames.reduce((a, c) => a + c, 0) / frames.length)).toFixed(1), layouts: after.LayoutCount - before.LayoutCount, styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount, cls: +(await p.evaluate(() => window.__cls)).toFixed(4), longTasks: await p.evaluate(() => window.__long), jsHeapMB: +(after.JSHeapUsedSize / 1e6).toFixed(1) };
  perf.push(row); console.log("PERF", JSON.stringify(row));
  await p.context().close();
  return row;
}
const d1 = await measure("desktop 1440x900", { width: 1440, height: 900 }, 1);
const d4 = await measure("desktop 1440x900", { width: 1440, height: 900 }, 4);
const f1 = await measure("desktop 1920x1080", { width: 1920, height: 1080 }, 1);
const m4 = await measure("mobile 375x812", { width: 375, height: 812, touch: true }, 4);
check("desktop holds about 60 fps with p95 under 33 ms", d1.fps >= 55 && d1.p95 < 33, d1);
check("1920 holds about 60 fps with p95 under 33 ms", f1.fps >= 55 && f1.p95 < 33, f1);
check("4x slower CPU: p95 stays under 50 ms", d4.p95 < 50, d4);
check("mobile at 4x slower CPU: p95 under 33 ms", m4.p95 < 33, m4);
check("no layout shift while scrolling through", [d1, d4, f1, m4].every((r) => r.cls < 0.01), [d1.cls, d4.cls, f1.cls, m4.cls]);
const sizes = ["industrial-process", "molecular-visualization", "clear-base-oil"].map((n) => fs.statSync(new URL(`../../public/media/ctl-technology/${n}.webp`, import.meta.url)).size);
check("images total under 200 KB", sizes.reduce((a, c) => a + c, 0) < 200000, sizes);

await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${out}/dogrulama.json`, JSON.stringify({ results, perf }, null, 2));
