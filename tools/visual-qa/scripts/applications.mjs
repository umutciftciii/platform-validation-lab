// Scroll, accessibility, CLS and content checks for the Applications section.
// Usage: node applications.mjs <base-url> <out-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base = "http://localhost:3110", out = "."] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 400)); };
const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` });

async function open({ width, height, touch = false, reduced = false, js = true, dpr = 1 }) {
  const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference", javaScriptEnabled: js });
  const p = await c.newPage();
  p.errors = []; p.bad = []; p.images = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text().slice(0, 300)); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) p.bad.push(`${r.status()} ${r.url()}`); if (r.url().includes("/media/applications/")) p.images.push(r.url().split("/").pop()); });
  await p.route("**://dreampetroleumbv.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
  await p.addInitScript(() => { window.__cls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls.push({ v: e.value, y: scrollY, s: e.sources?.map((x) => x.node?.className || x.node?.nodeName) }); }).observe({ type: "layout-shift", buffered: true }); });
  await p.goto(url, { waitUntil: "load" });
  if (js) await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return p;
}
const toP = async (p, f, wait = 1800) => { await p.evaluate((f) => { const s = document.querySelector(".apps-track"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + f * (s.offsetHeight - innerHeight), behavior: "instant" }); }, f); if (wait) await p.waitForTimeout(wait); };
const toEl = async (p, sel, offset = 90, wait = 1200) => { await p.evaluate(([sel, o]) => window.scrollTo({ top: document.querySelector(sel).getBoundingClientRect().top + scrollY - o, behavior: "instant" }), [sel, offset]); await p.waitForTimeout(wait); };
const state = (p) => p.evaluate(() => {
  const op = (e) => +(+getComputedStyle(e).opacity).toFixed(3);
  return {
    images: [...document.querySelectorAll(".apps-figure")].map(op),
    texts: [...document.querySelectorAll(".apps-text")].map(op),
    head: op(document.querySelector(".apps-head")),
    tag: op(document.querySelector(".apps-tag")),
    frameWidth: Math.round(document.querySelector(".apps-figure").getBoundingClientRect().width),
    scales: [...document.querySelectorAll(".apps-image")].map((e) => { const m = new DOMMatrix(getComputedStyle(e).transform); return +m.a.toFixed(3); }),
    shifts: [...document.querySelectorAll(".apps-image")].map((e) => +new DOMMatrix(getComputedStyle(e).transform).f.toFixed(1)),
    textY: [...document.querySelectorAll(".apps-text")].map((e) => +new DOMMatrix(getComputedStyle(e).transform).f.toFixed(1)),
    current: [...document.querySelectorAll(".apps-nav-item")].findIndex((e) => e.getAttribute("aria-current") === "step"),
    stickyTop: document.querySelector(".apps-sticky").getBoundingClientRect().top,
  };
});
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
/** Lowest contrast of each text line against the brightest pixel actually behind it. */
async function contrast(p, selectors) {
  const boxes = await p.evaluate((selectors) => selectors.flatMap((sel) => [...document.querySelectorAll(sel)].flatMap((e) => { const color = getComputedStyle(e).color; const range = document.createRange(); range.selectNodeContents(e); return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && r.bottom <= innerHeight && r.top >= 0).map((r) => ({ x: r.left, y: r.top, width: r.width, height: r.height, color: color.match(/[\d.]+/g).map(Number), name: sel })); })), selectors);
  const style = await p.addStyleTag({ content: selectors.map((s) => `${s},${s} *`).join(",") + "{color:transparent!important;text-decoration-color:transparent!important}.apps-nav-item::after{opacity:0}" });
  await p.waitForTimeout(350);
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
  await style.evaluate((n) => n.remove());
  return { low: +low.toFixed(2), lowName, lines: boxes.length };
}
async function axe(p, label) {
  await p.addScriptTag({ content: axeSource });
  const r = await p.evaluate(() => window.axe.run("#applications", { resultTypes: ["violations"] }));
  check(`${label}: axe violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}: ${v.nodes.length} ${v.nodes[0].target}`));
}

// Cinematic ------------------------------------------------------------------------
for (const [name, width, height] of [["1440x900", 1440, 900], ["1920x1080", 1920, 1080], ["1280x620", 1280, 620]]) {
  const p = await open({ width, height });
  await toP(p, 0, 500);
  await p.waitForFunction(() => [...document.querySelectorAll(".apps-image")].every((i) => i.complete && i.naturalWidth > 0));
  const m = await p.evaluate(() => { const h = document.querySelector(".apps-head").getBoundingClientRect(); const f = document.querySelector(".apps-figure").getBoundingClientRect(); return { h: document.querySelector(".apps-track").offsetHeight / innerHeight, overflow: document.documentElement.scrollWidth - innerWidth, pos: getComputedStyle(document.querySelector(".apps-sticky")).position, headBottom: Math.round(h.bottom), frameTop: Math.round(f.top), frameBottom: Math.round(f.bottom) }; });
  check(`${name}: sticky stage, 4.8 screens long, no sideways overflow`, m.pos === "sticky" && Math.abs(m.h - 4.8) < 0.01 && m.overflow <= 0, m);
  check(`${name}: opening heading clears the image window, window fits the screen`, m.headBottom <= m.frameTop && m.frameBottom <= height, m);
  if (name === "1440x900") { await p.waitForTimeout(600); await shot(p, "desktop-1440-1-giris"); }
  if (name === "1280x620") await shot(p, "kisa-ekran-1280x620-giris");
  for (const [f, scene, id] of [[0.27, 0, "2-seffaf-polimer"], [0.61, 1, "4-bebek-konsept"], [0.92, 2, "6-kisisel-bakim"]]) {
    await toP(p, f);
    const s = await state(p);
    check(`${name}: at ${f} only scene ${scene + 1} is on screen, buttons agree, label stays`, s.images.every((o, i) => (i === scene ? o === 1 : o === 0)) && s.texts.every((o, i) => (i === scene ? o === 1 : o === 0)) && s.current === scene && s.stickyTop === 0 && s.tag === 1 && s.head === 0, s);
    if (name !== "1920x1080" || scene === 0) await shot(p, name === "1440x900" ? `desktop-1440-${id}` : name === "1920x1080" ? "desktop-1920-seffaf-polimer" : `kisa-ekran-1280x620-sahne-${scene + 1}`);
    const fit = await p.evaluate((scene) => { const t = document.querySelectorAll(".apps-text")[scene].getBoundingClientRect(); const tag = document.querySelector(".apps-tag").getBoundingClientRect(); const nav = document.querySelector(".apps-nav").getBoundingClientRect(); return { top: Math.round(t.top), bottom: Math.round(t.bottom), tagRight: Math.round(tag.right), navLeft: Math.round(nav.left), navBottom: Math.round(nav.bottom), h: innerHeight }; }, scene);
    check(`${name}: scene ${scene + 1} text fits, top row does not collide`, fit.bottom <= fit.h && fit.top > fit.navBottom && fit.tagRight <= fit.navLeft, fit);
    const sel = [`.apps-text[data-scene="${scene}"] .apps-scene-title`, `.apps-text[data-scene="${scene}"] .apps-scene-body`, `.apps-text[data-scene="${scene}"] .apps-scene-note`, `.apps-text[data-scene="${scene}"] .apps-cta`, ".apps-tag", ".apps-nav-item"];
    const c = await contrast(p, sel);
    check(`${name}: scene ${scene + 1} text contrast >= 4.5:1 on brightest pixel`, c.low >= 4.5, c);
    await axe(p, `${name} scene ${scene + 1}`);
  }
  check(`${name}: no console errors or failed requests`, !p.errors.length && !p.bad.length, [...p.errors, ...p.bad]);
  await p.context().close();
}

// Transitions --------------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await toP(p, 0, 400);
  const samples = [];
  for (const f of [0, 0.02, 0.04, 0.07, 0.1, 0.13, 0.15, 0.2, 0.3, 0.4, 0.43, 0.45, 0.46, 0.48, 0.5, 0.52, 0.6, 0.7, 0.73, 0.75, 0.76, 0.78, 0.8, 0.82, 0.9, 1]) { await toP(p, f, 1500); samples.push({ f, ...(await state(p)) }); }
  check("two scenes' text is never visible together", samples.every((s) => s.texts.filter((o) => o > 0.001).length <= 1), samples.map((s) => s.texts));
  check("images crossfade: two visible inside each handover", [0.46, 0.76].every((f) => samples.find((s) => s.f === f).images.filter((o) => o > 0.1).length === 2), [samples.find((s) => s.f === 0.46).images, samples.find((s) => s.f === 0.76).images]);
  const widths = samples.filter((s) => s.f <= 0.2).map((s) => s.frameWidth);
  check("first image grows steadily from a window to past the screen edge", widths.every((v, i) => i === 0 || v >= widths[i - 1]) && widths[0] < 900 && widths[widths.length - 1] > 1440, widths);
  check("heading is gone before the first scene's text arrives", samples.every((s) => !(s.head > 0.01 && s.texts[0] > 0.01)), samples.map((s) => [s.head, s.texts[0]]));
  const inner = samples.filter((s) => s.f >= 0.45 && s.f <= 0.7).map((s) => s.scales[1]);
  check("incoming image settles, then pushes in slowly (scroll-linked scale)", inner[0] > inner[3] && inner[inner.length - 1] > inner[3], inner);
  const drift = samples.filter((s) => s.f >= 0.15 && s.f <= 0.5).map((s) => s.shifts[0]);
  check("image drifts up slower than the text moves (parallax)", drift.every((v, i) => i === 0 || v < drift[i - 1]) && Math.abs(drift[drift.length - 1] - drift[0]) < 56 + 36, drift);
  check("buttons follow the scene", samples.filter((s) => ![0.46, 0.76].includes(s.f)).every((s) => s.current === (s.f < 0.46 ? 0 : s.f < 0.76 ? 1 : 2)), samples.map((s) => [s.f, s.current]));
  check("sticky frame stays pinned through the whole range", samples.every((s) => Math.abs(s.stickyTop) <= 1), samples.map((s) => s.stickyTop));
  await toP(p, 0.07); await shot(p, "desktop-1440-gecis-buyume");
  await toP(p, 0.46); await shot(p, "desktop-1440-3-gecis-1-2");
  await toP(p, 0.76); await shot(p, "desktop-1440-5-gecis-2-3");
  await toP(p, 0.61); const there = await state(p);
  await toP(p, 0.27); const back = await state(p);
  check("scrolling back reverses the story", there.current === 1 && back.current === 0 && back.images[0] === 1 && back.images[1] === 0);

  // Normal page scrolling.
  await toP(p, 0.4, 800);
  await p.mouse.move(700, 450);
  const y0 = await p.evaluate(() => scrollY);
  const seen = [];
  for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(150); seen.push(await p.evaluate(() => scrollY)); }
  check("wheel moves the page by exactly its own distance", seen.every((v, i) => v === y0 + (i + 1) * 120), { y0, seen });
  await toP(p, 1, 300);
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 200); await p.waitForTimeout(60); }
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ top: document.querySelector(".apps-sticky").getBoundingClientRect().top, validation: document.querySelector(".apps-validation").getBoundingClientRect().top }));
  check("scrolling continues out of the stage into the validation panel", after.top < 0 && after.validation < 900, after);
  await p.waitForTimeout(600);
  await toEl(p, ".apps-validation", 90);
  await shot(p, "desktop-1440-7-dogrulama");
  await p.evaluate(() => { const s = document.querySelector("#applications"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight / 2, behavior: "instant" }); });
  await p.waitForTimeout(100);
  const w0 = await p.evaluate(() => scrollY);
  await p.mouse.wheel(0, -240); await p.waitForTimeout(250);
  check("scrolling up out of the section into CTL still works", (await p.evaluate(() => scrollY)) === w0 - 240);

  // Scene buttons, keyboard and skip link.
  await toP(p, 0.02, 1200);
  await p.locator(".apps-nav-item").nth(2).click();
  await p.waitForFunction(() => document.querySelectorAll(".apps-nav-item")[2].getAttribute("aria-current") === "step", null, { timeout: 8000 });
  await p.waitForTimeout(2500);
  const jumped = await state(p);
  check("scene button goes to that scene", jumped.images[2] === 1 && jumped.texts[2] === 1, jumped);

  await toP(p, 0, 1500);
  // Reached with Tab, as a keyboard user would: the link only shows on :focus-visible.
  await p.evaluate(() => document.querySelector(".ctl-document").focus());
  await p.keyboard.press("Tab");
  await p.waitForTimeout(200);
  const order = [];
  const skipVisible = await p.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return a.classList.contains("skip-link") && r.top >= 0 && r.bottom <= innerHeight; });
  await toP(p, 0, 1500);
  const seenScene = [];
  for (let i = 0; i < 7; i++) {
    await p.keyboard.press("Tab");
    await p.waitForTimeout(2600);
    const el = await p.evaluate(() => { const a = document.activeElement; const t = a.closest(".apps-text"); return { label: a.textContent.trim().slice(0, 34), scene: t ? +t.dataset.scene : null, opacity: t ? +getComputedStyle(t).opacity : null, rect: (() => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })() }; });
    order.push(el.label); seenScene.push(el);
    if (el.scene === 1) await shot(p, "desktop-1440-klavye-odagi");
  }
  check("Tab order: three scene links in order, then the three buttons, then contact", order[0] === "Discuss this concept" && order[1] === "See what validation requires" && order[2] === "See how ICCSYN is made" && order[3] === "Transparent Polymers" && order[5] === "Personal Care Packaging" && order[6] === "Contact Dream Petroleum", order);
  check("each focused scene link is on screen and fully visible", seenScene.filter((s) => s.scene !== null).every((s) => s.opacity === 1 && s.rect), seenScene);
  await p.evaluate(() => document.querySelector("#applications .skip-link").focus());
  await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  const skipped = await p.evaluate(() => ({ validationTop: document.querySelector(".apps-validation").getBoundingClientRect().top, hash: location.hash }));
  check("skip link is visible on focus and lands on the validation panel", skipVisible && skipped.validationTop < 900 && skipped.hash === "#applications-validation", { skipVisible, skipped });
  await p.context().close();
}

// Inactive links must not take clicks -----------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await toP(p, 0.61);
  const hit = await p.evaluate(() => { const links = [...document.querySelectorAll(".apps-text .apps-cta")].map((a) => a.getBoundingClientRect()); const active = links[1]; const top = document.elementFromPoint(active.left + 5, active.top + active.height / 2); return { label: top?.textContent?.trim().slice(0, 34), events: [...document.querySelectorAll(".apps-text")].map((t) => getComputedStyle(t).pointerEvents) }; });
  check("only the visible scene's link takes clicks", hit.label === "See what validation requires" && hit.events.join() === "none,auto,none", hit);
  await p.context().close();
}

// Reload and CLS --------------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await toP(p, 0.61, 400);
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(2800);
  const s = await state(p);
  check("reload partway down paints the right scene", s.current === 1 && s.images[1] === 1 && s.texts[1] === 1, s);
  await p.context().close();
}
for (const [name, opts] of [["1440x900", { width: 1440, height: 900 }], ["375x812", { width: 375, height: 812, touch: true, dpr: 3 }]]) {
  const p = await open(opts);
  // Start after the earlier sections' own lazy work, then walk the whole section.
  await toEl(p, "#applications", 1500, 1500);
  await p.evaluate(() => { window.__cls.length = 0; });
  const heightBefore = await p.evaluate(() => document.querySelector("#applications").offsetHeight);
  const { top, bottom } = await p.evaluate(() => { const r = document.querySelector("#applications").getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; });
  const frames = await p.evaluate(async ([from, to]) => {
    const times = []; let last = performance.now();
    const t0 = last, total = 6000;
    await new Promise((done) => { const step = (now) => { times.push(now - last); last = now; const t = (now - t0) / total; window.scrollTo({ top: from + (to - from) * Math.min(1, t), behavior: "instant" }); if (t < 1) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
    times.sort((a, b) => a - b);
    return { n: times.length, median: +times[times.length >> 1].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), worst: +times[times.length - 1].toFixed(1) };
  }, [top - 900, bottom]);
  await p.waitForTimeout(1500);
  const cls = await p.evaluate(() => window.__cls);
  const heightAfter = await p.evaluate(() => document.querySelector("#applications").offsetHeight);
  const sum = +cls.reduce((a, e) => a + e.v, 0).toFixed(4);
  check(`${name}: CLS while crossing the section is under 0.01`, sum < 0.01, { sum, entries: cls.slice(0, 4) });
  check(`${name}: section height does not change`, heightBefore === heightAfter, { heightBefore, heightAfter });
  results.push({ name: `${name}: frame times (dev build, not a pass/fail)`, pass: true, detail: frames }); console.log("INFO", name, "frames", JSON.stringify(frames));
  await p.context().close();
}
{
  // Before hydration: the stylesheet alone gives the same geometry.
  const noJs = await open({ width: 375, height: 812, touch: true, js: false });
  const hNoJs = await noJs.locator("#applications").evaluate((e) => e.offsetHeight);
  const withJs = await open({ width: 375, height: 812, touch: true });
  await withJs.waitForTimeout(800);
  const hJs = await withJs.locator("#applications").evaluate((e) => e.offsetHeight);
  check("375x812: hydration does not change the section height", hNoJs === hJs, { hNoJs, hJs });
  await noJs.context().close(); await withJs.context().close();
}

// Mobile ----------------------------------------------------------------------------------
{
  const p = await open({ width: 375, height: 812, touch: true, dpr: 3 });
  await toEl(p, "#applications", 1500, 1200);
  const hidden = await p.evaluate(() => [...document.querySelectorAll(".apps-scene")].map((s) => [getComputedStyle(s.querySelector(".apps-text")).opacity, s.dataset.visible]));
  check("375x812: scenes wait off screen for their reveal", hidden.every(([o, v]) => o === "0" && v === "false"), hidden);
  const m = await p.evaluate(() => ({ sticky: getComputedStyle(document.querySelector(".apps-sticky")).position, track: getComputedStyle(document.querySelector(".apps-track")).height, inline: [...document.querySelectorAll(".apps-figure,.apps-text,.apps-sticky")].filter((e) => e.getAttribute("style")).length, overflow: document.documentElement.scrollWidth - innerWidth, nav: getComputedStyle(document.querySelector(".apps-nav")).display, tag: getComputedStyle(document.querySelector(".apps-tag")).display, will: getComputedStyle(document.querySelector(".apps-image")).willChange }));
  check("375x812: light layout: no sticky, nothing written on scroll, no overflow", m.sticky === "static" && m.inline === 0 && m.overflow <= 0 && m.nav === "none" && m.tag === "none" && m.will === "auto", m);
  await toEl(p, "#applications", 0, 900);
  await shot(p, "mobil-375-0-giris");
  const tops = await p.evaluate(() => [...document.querySelectorAll(".apps-scene")].map((s) => s.getBoundingClientRect().top + scrollY));
  for (const [i, top] of tops.entries()) {
    await p.evaluate((t) => window.scrollTo({ top: t - 80, behavior: "instant" }), top);
    await p.waitForTimeout(1400);
    const st = await p.evaluate((i) => { const s = document.querySelectorAll(".apps-scene")[i]; const t = s.querySelector(".apps-text"); const img = s.querySelector("img"); const c = s.querySelector(".apps-cta").getBoundingClientRect(); return { op: getComputedStyle(t).opacity, loaded: img.complete && img.naturalWidth > 0, current: img.currentSrc.split("/").pop(), cta: c.height, inView: c.bottom <= innerHeight }; }, i);
    check(`375x812 DPR 3: scene ${i + 1} revealed, small image loaded, 44 px link, whole scene fits one screen`, st.op === "1" && st.loaded && st.current.endsWith("-828.webp") && st.cta >= 44 && st.inView, st);
    await shot(p, `mobil-375-${i + 1}`);
    const c = await contrast(p, [`.apps-scene:nth-child(${i + 1}) .apps-scene-title`, `.apps-scene:nth-child(${i + 1}) .apps-scene-body`, `.apps-scene:nth-child(${i + 1}) .apps-scene-note`, `.apps-scene:nth-child(${i + 1}) .apps-cta`]);
    check(`375x812: scene ${i + 1} text contrast >= 4.5:1 on brightest pixel`, c.low >= 4.5, c);
  }
  check("375x812: only the small images download", p.images.every((n) => n.endsWith("-828.webp")) && new Set(p.images).size === 3, [...new Set(p.images)]);
  const stay = await p.evaluate(() => [...document.querySelectorAll(".apps-scene")].map((s) => s.dataset.visible));
  await p.evaluate(() => window.scrollBy({ top: -1000, behavior: "instant" })); await p.waitForTimeout(300);
  check("375x812: a reveal runs only once", stay.every((v) => v === "true"));
  const cdp = await p.context().newCDPSession(p);
  const y0 = await p.evaluate(() => scrollY);
  await cdp.send("Input.synthesizeScrollGesture", { x: 180, y: 500, yDistance: -300, speed: 1200, gestureSourceType: "touch" });
  await p.waitForTimeout(300);
  check("375x812: swipe scrolls the page normally", (await p.evaluate(() => scrollY)) > y0);
  await toEl(p, ".apps-validation", 72);
  await shot(p, "mobil-375-4-dogrulama");
  await axe(p, "375x812");
  check("375x812: no console errors or failed requests", !p.errors.length && !p.bad.length, [...p.errors, ...p.bad]);
  await p.context().close();
}

// Reduced motion and no script ------------------------------------------------------------
for (const [name, file, opts] of [
  ["reduced motion 1440x900", "azaltilmis-hareket-1440x900", { width: 1440, height: 900, reduced: true }],
  ["reduced motion 375x812", "azaltilmis-hareket-375x812", { width: 375, height: 812, touch: true, reduced: true }],
  ["no script 1440x900", "js-kapali-1440x900", { width: 1440, height: 900, js: false }],
  ["no script 375x812", "js-kapali-375x812", { width: 375, height: 812, touch: true, js: false }],
]) {
  const p = await open(opts);
  const m = await p.locator("#applications").evaluate((root) => {
    const all = [...root.querySelectorAll(".apps-figure,.apps-text")];
    return { sticky: getComputedStyle(root.querySelector(".apps-sticky")).position, reveal: root.dataset.reveal, ops: all.map((e) => getComputedStyle(e).opacity), vis: all.map((e) => getComputedStyle(e).visibility), inline: all.filter((e) => e.getAttribute("style")).length, transform: getComputedStyle(root.querySelector(".apps-image")).transform, transition: getComputedStyle(root.querySelector(".apps-text")).transitionDuration, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check(`${name}: stacked, everything visible, no animation`, m.sticky === "static" && m.reveal === "false" && m.ops.every((o) => o === "1") && m.vis.every((v) => v === "visible") && m.inline === 0 && m.transform === "none" && m.transition === "0s" && m.overflow <= 0, m);
  // The eager-load switch needs script; without it the browser's own lazy load runs on scroll.
  await p.locator("#applications").evaluate((e) => e.scrollIntoView({ behavior: "instant" }));
  await p.waitForTimeout(1000);
  await shot(p, file);
  await p.locator(".apps-scene").nth(1).evaluate((e) => e.scrollIntoView({ behavior: "instant", block: "center" }));
  await p.waitForTimeout(1000);
  const loaded = await p.locator(".apps-scene img").nth(1).evaluate((i) => i.complete && i.naturalWidth > 0);
  check(`${name}: image loads as it is reached`, loaded);
  if (!name.startsWith("no script")) await axe(p, name);
  await p.context().close();
}

// Content rules ---------------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  const text = await p.locator("#applications").evaluate((e) => e.textContent);
  check("section is marked with the exact label", text.includes("Potential Application Concepts — Pending Technical Validation"));
  check("every scene carries its disclosure", (text.match(/AI-generated concept image\. Not a real product and not a verified ICCSYN application\./g) || []).length === 3);
  const banned = /\b(suitable for|safe for|approved for|certified|compliant|food[- ]grade|FDA|REACH|ISO \d|non-toxic|BPA|used in|proven|ideal for|recommended for|hypoallergenic)\b/i;
  const m = text.match(banned);
  check("no suitability, safety or certification claim", !m, m?.[0]);
  const alts = await p.locator(".apps-image").evaluateAll((i) => i.map((e) => e.alt));
  check("every image alt says it is an AI-generated concept", alts.length === 3 && alts.every((a) => a.startsWith("AI-generated concept image")), alts);
  const order = await p.evaluate(() => { const c = document.querySelector("#ctl-technology"), a = document.querySelector("#applications"); return { directlyAfter: c.nextElementSibling === a, h2: a.querySelectorAll("h2").length, h3: a.querySelectorAll("h3").length, sceneHasHorizontalControls: !!a.querySelector("[class*=arrow],[class*=prev],[class*=next]") }; });
  check("placed right after CTL, one h2, four h3, no slider controls", order.directlyAfter && order.h2 === 1 && order.h3 === 4 && !order.sceneHasHorizontalControls, order);
  await p.context().close();
}

await b.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(`${out}/dogrulama.json`, JSON.stringify({ date: new Date().toISOString(), url, passed: results.length - failed.length, failed: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
