// Text fit checks for the CTL section. Usage: node ctl-text.mjs <base-url> <out-dir>
import { chromium } from "playwright-core";
const [base = "http://localhost:3110", out = "."] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
let failed = 0, total = 0;
const check = (name, pass, detail) => { total++; if (!pass) failed++; console.log(pass ? "PASS" : "FAIL", name, pass ? "" : JSON.stringify(detail).slice(0, 400)); };
const fit = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll("#ctl-technology h2, #ctl-technology h3, #ctl-technology p, #ctl-technology .ctl-document, #ctl-technology .ctl-nav-item").forEach((e) => {
    if (getComputedStyle(e).display === "none" || !e.getClientRects().length) return;
    const range = document.createRange(); range.selectNodeContents(e);
    for (const r of range.getClientRects()) if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${e.className || e.tagName} x ${Math.round(r.left)}-${Math.round(r.right)}`);
    if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== "inline") out.push(`${e.className || e.tagName} scroll ${e.scrollWidth}>${e.clientWidth}`);
  });
  return { out, pageOverflow: document.documentElement.scrollWidth - innerWidth };
};
const go = (p, f) => p.evaluate((f) => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + f * (s.offsetHeight - innerHeight), behavior: "instant" }); }, f);

for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [1024, 600], [900, 560]]) {
  const c = await b.newContext({ viewport: { width, height } });
  const p = await c.newPage();
  await p.goto(`${base}/demo/iccsyn-hero-products`, { waitUntil: "load" });
  for (const [i, f] of [[0, 0.14], [1, 0.52], [2, 0.9]]) {
    await go(p, f); await p.waitForTimeout(1500);
    const m = await p.evaluate(({ i, fit }) => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const t = document.querySelectorAll(".ctl-text")[i];
      const f = eval(`(${fit})`)();
      return { ...f, text: box(t), title: box(document.querySelector(".ctl-title")), foot: box(document.querySelector(".ctl-foot")), vh: innerHeight, lines: (() => { const r = document.createRange(); r.selectNodeContents(t.querySelector("h3")); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; })() };
    }, { i, fit: fit.toString() });
    const ok = !m.out.length && m.pageOverflow <= 0 && m.text.top >= m.title.bottom && m.text.bottom <= m.foot.top && m.foot.bottom <= m.vh;
    check(`${width}x${height} stage ${i + 1}: text clear of heading and buttons, nothing cut (title lines ${m.lines})`, ok, { gapTop: m.text.top - m.title.bottom, gapBottom: m.foot.top - m.text.bottom, out: m.out, po: m.pageOverflow });
    if (i === 1 && [1920, 1440].includes(width)) await p.screenshot({ path: `${out}/metin-${width}-molecular-engineering.png` });
  }
  await c.close();
}
for (const [width, height, reduced] of [[320, 568], [375, 812], [390, 844], [768, 1024], [844, 390], [1440, 900, true]]) {
  const c = await b.newContext({ viewport: { width, height }, hasTouch: width < 900, isMobile: width < 900, reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await c.newPage();
  await p.goto(`${base}/demo/iccsyn-hero-products`, { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const e = document.querySelectorAll(".ctl-stage")[1]; window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 80, behavior: "instant" }); });
  await p.waitForTimeout(1200);
  const m = await p.evaluate(fit);
  check(`${width}x${height}${reduced ? " reduced motion" : ""}: stacked text fits the width`, !m.out.length && m.pageOverflow <= 0, m);
  if (width === 375) await p.screenshot({ path: `${out}/metin-375-molecular-engineering.png` });
  await c.close();
}
{
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  await p.goto(`${base}/demo/iccsyn-hero-products`, { waitUntil: "load" });
  const titles = await p.locator(".ctl-stage-title").allTextContents();
  check("stage titles", titles.join("|") === "Industrial Process|Molecular Engineering|Clear Base Oil", titles);
  const nav = await p.locator(".ctl-nav-item").allTextContents();
  check("stage buttons use the same names", nav.join("|") === titles.join("|"), nav);
  check("old title is gone", !(await p.locator("#ctl-technology").textContent()).includes("Molecular Visualization"));
  await c.close();
}
await b.close();
console.log(`\n${total - failed}/${total} passed`);
