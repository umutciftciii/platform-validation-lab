// Behaviour checks for the Services Showcase. Usage: node services.mjs <base-url> <out-dir>
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const [base = "http://localhost:3110", out = "."] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(pass ? "PASS" : "FAIL", name, detail === undefined ? "" : JSON.stringify(detail).slice(0, 300)); };

async function open({ width, height, touch = false, reduced = false }) {
  const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await c.newPage();
  p.errors = []; p.bad = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") p.errors.push(m.text()); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) p.bad.push(`${r.status()} ${r.url()}`); });
  // Never reach the live site from a test.
  await p.route("**://dreampetroleumbv.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
  await p.goto(url, { waitUntil: "load" });
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.evaluate(() => { window.scrollTo({ top: document.querySelector("#services").getBoundingClientRect().top + scrollY, behavior: "instant" }); });
  await p.waitForFunction(() => [...document.querySelectorAll(".sv-image")].every((i) => i.complete && i.naturalWidth > 0));
  await p.waitForTimeout(400);
  return p;
}
const left = (p) => p.evaluate(() => document.querySelector(".sv-track").scrollLeft);
const y = (p) => p.evaluate(() => scrollY);
const settle = (p, ms = 900) => p.waitForTimeout(ms);
const cardVisibility = (p) => p.evaluate(() => { const t = document.querySelector(".sv-track").getBoundingClientRect(); return [...document.querySelectorAll(".sv-card")].map((c) => { const r = c.getBoundingClientRect(); const vis = Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left)); return +(vis / r.width).toFixed(3); }); });

// Layout and crop in the three requested viewports -------------------------------
for (const [name, width, height, touch] of [["1440x900", 1440, 900, false], ["1920x1080", 1920, 1080, false], ["375x812", 375, 812, true]]) {
  const p = await open({ width, height, touch });
  const vis = await cardVisibility(p);
  if (touch) check(`${name}: one whole card, a sliver of the next`, vis[0] === 1 && vis[1] > 0.05 && vis[1] < 0.2 && vis[2] === 0, vis);
  else check(`${name}: two whole cards, part of the third`, vis[0] === 1 && vis[1] === 1 && vis[2] > 0.1 && vis[2] < 0.5, vis);
  check(`${name}: no page overflow sideways`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const m = await p.evaluate(() => { const s = document.querySelector("#services").getBoundingClientRect(); const f = document.querySelector(".sv-foot").getBoundingClientRect(); return { sectionH: s.height, footBottom: f.bottom, vh: innerHeight, src: [...document.querySelectorAll(".sv-image")].map((i) => i.currentSrc.split("/").pop()), textFits: [...document.querySelectorAll(".sv-card")].every((c) => c.querySelector(".sv-card-text").getBoundingClientRect().top >= c.getBoundingClientRect().top && c.querySelector(".sv-card-link").getBoundingClientRect().bottom <= c.getBoundingClientRect().bottom) }; });
  check(`${name}: section fits one screen, controls visible`, m.footBottom <= m.vh && Math.abs(m.sectionH - m.vh) < 1, m);
  check(`${name}: correct crop loaded`, m.src.every((s) => s.endsWith(touch ? "-mobile.webp" : "-desktop.webp")), m.src);
  check(`${name}: text panel fits the card`, m.textFits);
  // Pixel contrast: hide the text, read the background behind each text line.
  await p.addStyleTag({ content: ".sv-contrast .sv-card-title,.sv-contrast .sv-card-body,.sv-contrast .sv-card-link{color:transparent!important}" });
  let worst = Infinity;
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, c) => { const [h, l] = a > c ? [a, c] : [c, a]; return (h + 0.05) / (l + 0.05); };
  const count = await p.locator(".sv-card").count();
  for (let i = 0; i < count; i++) {
    await p.evaluate((i) => { const t = document.querySelector(".sv-track"); t.style.scrollSnapType = "none"; const c = t.children[i]; t.scrollLeft = c.offsetLeft - 24; document.querySelector("#services").classList.add("sv-contrast"); }, i);
    await p.waitForTimeout(150);
    const boxes = await p.evaluate((i) => { const c = document.querySelectorAll(".sv-card")[i]; const v = document.querySelector(".sv-track").getBoundingClientRect(); return [...c.querySelectorAll(".sv-card-title,.sv-card-body,.sv-card-link")].filter((e) => getComputedStyle(e).display !== "none").map((e) => { const r = e.getBoundingClientRect(); const x0 = Math.max(r.left, v.left), x1 = Math.min(r.right, v.right); return { x: x0, y: r.top, width: x1 - x0, height: r.height, color: e.classList.contains("sv-card-link") ? [233, 162, 59] : e.classList.contains("sv-card-title") ? [237, 243, 247] : [213, 222, 231] }; }); }, i);
    for (const box of boxes) {
      const png = (await p.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } })).toString("base64");
      const maxBg = await p.evaluate(async (png) => { const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode(); const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let best = [0, 0, 0], bl = -1; for (let i = 0; i < d.length; i += 4) { const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; if (l > bl) { bl = l; best = [d[i], d[i + 1], d[i + 2]]; } } return best; }, png);
      worst = Math.min(worst, ratio(lum(...box.color), lum(...maxBg)));
    }
  }
  check(`${name}: text contrast on brightest background pixel >= 4.5:1`, worst >= 4.5, +worst.toFixed(2));
  await p.evaluate(() => { document.querySelector("#services").classList.remove("sv-contrast"); const t = document.querySelector(".sv-track"); t.style.scrollSnapType = ""; t.scrollLeft = 0; });
  await p.addScriptTag({ content: axeSource });
  const axe = await p.evaluate(() => window.axe.run("#services", { resultTypes: ["violations"] }));
  check(`${name}: axe violations`, axe.violations.length === 0, axe.violations.map((v) => `${v.id}: ${v.nodes.length}`));
  check(`${name}: no console errors or failed requests`, !p.errors.length && !p.bad.length, [...p.errors, ...p.bad]);
  await p.context().close();
}

// Desktop interaction --------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  const box = await p.locator(".sv-track").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  const y0 = await y(p), l0 = await left(p);
  await p.mouse.wheel(0, 120); await settle(p, 500);
  const y1 = await y(p);
  check("vertical wheel over the cards scrolls the page, not the track", y1 > y0 && (await left(p)) === l0, { y0, y1 });
  await p.mouse.wheel(0, -120); await settle(p, 500);
  const y2 = await y(p);
  await p.mouse.wheel(300, 0); await settle(p);
  const l1 = await left(p);
  check("horizontal wheel (trackpad) moves the track, not the page", l1 > l0 && (await y(p)) === y2, { l1 });
  await p.evaluate(() => { document.querySelector(".sv-track").scrollLeft = 0; }); await settle(p, 300);

  const next = p.getByRole("button", { name: "Next services" }), prev = p.getByRole("button", { name: "Previous services" });
  check("previous is disabled at the start", (await prev.getAttribute("aria-disabled")) === "true");
  await next.click(); await settle(p);
  const max = await p.evaluate(() => { const t = document.querySelector(".sv-track"); return t.scrollWidth - t.clientWidth; });
  check("next arrow moves to the end; third card is whole", Math.abs((await left(p)) - max) <= 1 && (await cardVisibility(p))[2] === 1, await cardVisibility(p));
  check("next is disabled at the end and keeps focus", (await next.getAttribute("aria-disabled")) === "true" && (await next.evaluate((e) => e === document.activeElement)));
  await next.evaluate((e) => e.click()); await settle(p, 300);
  check("disabled next does nothing", Math.abs((await left(p)) - max) <= 1);
  await prev.click(); await settle(p);
  check("previous arrow returns to the start", (await left(p)) <= 1);

  // Mouse drag
  let navigations = 0;
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navigations++; });
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx - i * 25, cy);
  const mid = await left(p);
  await p.mouse.up(); await settle(p, 1100);
  const end = await left(p);
  check("mouse drag moves the track and settles on a resting point", mid > 200 && Math.abs(end - max) <= 1, { mid, end, max });
  check("drag over a card does not open its link", navigations === 0 && p.url() === url);
  check("snap is back on after a drag", await p.evaluate(() => { const t = document.querySelector(".sv-track"); return !t.dataset.dragging && getComputedStyle(t).scrollSnapType.includes("mandatory"); }));
  await p.mouse.move(cx, cy); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(cx + i * 25, cy);
  await p.mouse.up(); await settle(p, 1100);
  check("mouse drag back returns to the start", (await left(p)) <= 1);
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 20, cy); await p.mouse.up(); await settle(p, 1100);
  check("short drag falls back to the nearest card", (await left(p)) <= 1, await left(p));

  // Hover
  const card = p.locator(".sv-card").first();
  await p.mouse.move(2, 2); await settle(p, 300);
  const rest = await card.evaluate((c) => ({ t: getComputedStyle(c.querySelector(".sv-image")).transform, b: getComputedStyle(c, "::before").boxShadow }));
  await card.hover(); await settle(p, 900);
  const hovered = await card.evaluate((c) => ({ t: getComputedStyle(c.querySelector(".sv-image")).transform, b: getComputedStyle(c, "::before").boxShadow }));
  check("hover zooms the image and lights the amber border", hovered.t.startsWith("matrix(1.04") && hovered.b.includes("233, 162, 59") && !rest.b.includes("233, 162, 59"), hovered);
  await p.screenshot({ path: `${out}/desktop-1440-hover.png` });

  // A real click opens the source page.
  await p.locator(".sv-card").nth(1).click({ position: { x: 300, y: 120 } });
  await p.waitForURL("**/en/storage-distribution");
  check("click anywhere on a card opens its Learn More page", p.url() === "https://dreampetroleumbv.com/en/storage-distribution", p.url());
  await p.context().close();
}

// Keyboard -------------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  await p.locator(".sv-card-link").first().focus();
  const focused = () => p.evaluate(() => document.activeElement.getAttribute("aria-label"));
  await p.keyboard.press("Shift+Tab"); await p.keyboard.press("Tab"); await settle(p, 300);
  check("Tab lands on the first card link", (await focused()) === "Learn More about Energy Trading & Supply", await focused());
  const style = await p.evaluate(() => { const a = document.activeElement; const c = a.closest(".sv-card"); return { outline: getComputedStyle(a).outlineStyle, ring: getComputedStyle(c, "::before").boxShadow }; });
  check("focused link shows outline and amber card ring", style.outline === "solid" && style.ring.includes("233, 162, 59"), style);
  await p.screenshot({ path: `${out}/desktop-1440-klavye-odagi.png` });
  await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); await settle(p);
  check("Tab to the third card brings all of it into view", (await focused()) === "Learn More about Logistics" && (await cardVisibility(p))[2] === 1, await cardVisibility(p));
  await p.keyboard.press("Tab"); await settle(p, 200);
  check("Tab continues to the arrows", await p.evaluate(() => document.activeElement.getAttribute("aria-label") === "Previous services"));
  await p.locator(".sv-card-link").first().focus(); await settle(p, 200);
  await p.keyboard.press("ArrowRight"); await settle(p);
  check("ArrowRight moves to the next card", (await focused()) === "Learn More about Storage & Distribution");
  await p.keyboard.press("End"); await settle(p);
  check("End moves to the last card", (await focused()) === "Learn More about Logistics" && (await cardVisibility(p))[2] === 1);
  await p.keyboard.press("Home"); await settle(p);
  check("Home moves to the first card and the start", (await focused()) === "Learn More about Energy Trading & Supply" && (await left(p)) <= 1, await left(p));
  const before = await left(p);
  await p.waitForTimeout(8000);
  check("no automatic scrolling", (await left(p)) === before);
  await p.context().close();
}

// Touch ----------------------------------------------------------------------------
{
  const p = await open({ width: 375, height: 812, touch: true });
  const cdp = await p.context().newCDPSession(p);
  const box = await p.locator(".sv-track").boundingBox();
  const swipe = (xDistance, yDistance) => cdp.send("Input.synthesizeScrollGesture", { x: box.x + box.width / 2, y: box.y + box.height / 2, xDistance, yDistance, speed: 1200, gestureSourceType: "touch" });
  const y0 = await y(p);
  await swipe(-200, 0); await settle(p);
  const l1 = await left(p);
  const second = await p.evaluate(() => { const t = document.querySelector(".sv-track"); return t.children[1].offsetLeft - parseFloat(getComputedStyle(t).scrollPaddingLeft); });
  check("swipe snaps to the second card; the page stays still", Math.abs(l1 - second) <= 1 && (await y(p)) === y0, { l1, second });
  const vis = await cardVisibility(p);
  check("second card is whole with both neighbours peeking", vis[1] === 1 && vis[2] > 0, vis);
  await swipe(-400, 0); await settle(p);
  check("swipe reaches the last card", (await cardVisibility(p))[2] === 1, await cardVisibility(p));
  const y1 = await y(p), l2 = await left(p);
  await swipe(0, -240); await settle(p, 500);
  check("vertical swipe over the cards scrolls the page", (await y(p)) > y1 && (await left(p)) === l2, { y1, y2: await y(p) });
  const targets = await p.evaluate(() => [...document.querySelectorAll(".sv-arrow,.sv-card-link")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check("touch targets are at least 44 px", targets.every(([w, h]) => h >= 44 && w >= 44), targets);
  await p.context().close();
}

// Reduced motion -------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900, reduced: true });
  await p.getByRole("button", { name: "Next services" }).click();
  await p.waitForTimeout(60);
  const max = await p.evaluate(() => { const t = document.querySelector(".sv-track"); return t.scrollWidth - t.clientWidth; });
  check("reduced motion: arrow jumps with no animation", Math.abs((await left(p)) - max) <= 1, await left(p));
  const card = p.locator(".sv-card").nth(2);
  await card.hover(); await p.waitForTimeout(100);
  const s = await card.evaluate((c) => { const i = getComputedStyle(c.querySelector(".sv-image")); return { t: i.transform, d: i.transitionDuration, b: getComputedStyle(c, "::before").boxShadow }; });
  check("reduced motion: no zoom or transition; amber border stays", s.t === "none" && s.d === "0s" && s.b.includes("233, 162, 59"), s);
  await p.context().close();
}

// Neighbours -----------------------------------------------------------------------
{
  const p = await open({ width: 1440, height: 900 });
  const order = await p.evaluate(() => [...document.querySelector("main").children].map((e) => e.id || e.className.split(" ")[0]));
  const pgIndex = order.indexOf("product-groups");
  check("section sits right after Product Groups", order[pgIndex + 1] === "services", order);
  await p.evaluate(() => window.scrollTo({ top: document.querySelector("#product-groups").getBoundingClientRect().top + scrollY, behavior: "instant" }));
  const interval = await p.evaluate(() => new Promise((resolve) => { const t = [...document.querySelectorAll(".pg-group")]; const current = () => t.findIndex((e) => e.getAttribute("aria-current") === "true"); let start = current(), first = 0; const timer = setInterval(() => { const n = current(); if (n !== start) { const now = performance.now(); if (!first) { first = now; start = n; } else { clearInterval(timer); resolve(now - first); } } }, 20); setTimeout(() => { clearInterval(timer); resolve(-1); }, 20000); }));
  check("Product Groups still rotates every 7 s", Math.abs(interval - 7000) < 200, Math.round(interval));
  const heroHeights = await p.evaluate(() => { const hero = document.querySelector(".hero-animated"); return { heroVh: hero.getBoundingClientRect().height / innerHeight }; });
  check("hero keeps its 2.4-screen scroll length", Math.abs(heroHeights.heroVh - 2.4) < 0.02, heroHeights);
  await p.context().close();
  for (const route of ["iccsyn-hero", "iccsyn-hero-compact", "iccsyn-hero-nav"]) {
    const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const q = await c.newPage();
    const r = await q.goto(`${base}/demo/${route}`, { waitUntil: "load" });
    check(`/demo/${route} is unchanged`, r.status() === 200 && (await q.locator("#services").count()) === 0);
    await c.close();
  }
}

await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`${out}/dogrulama.json`, JSON.stringify(results, null, 2));
