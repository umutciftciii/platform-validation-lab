// CTL state with script on and off, at phone and desktop size, for before/after comparison.
// Usage: node ctl-fallback.mjs <base-url> <json-out> [screenshot-dir]
import { chromium } from "playwright-core";
import fs from "node:fs";
const [base = "http://localhost:3110", outFile = "ctl-fallback.json", shots] = process.argv.slice(2);
const url = `${base}/demo/iccsyn-hero-products`;
const b = await chromium.launch({ channel: "chrome", headless: true });
const sizes = [["375x812", 375, 812, true], ["1440x900", 1440, 900, false]];
const report = {};
for (const [name, width, height, touch] of sizes) {
  // Script off: normal document flow, everything visible and in reading order.
  {
    const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, javaScriptEnabled: false });
    const p = await c.newPage();
    await p.goto(url, { waitUntil: "load" });
    const top = await p.locator("#ctl-technology").evaluate((e) => e.getBoundingClientRect().top + scrollY);
    const heights = [];
    for (let i = 0; i < 3; i++) {
      await p.locator(".ctl-stage").nth(i).evaluate((e) => e.scrollIntoView({ behavior: "instant", block: "center" }));
      await p.waitForTimeout(900);
      if (shots) await p.screenshot({ path: `${shots}/js-kapali-${name}-asama-${i + 1}.png` });
      heights.push(await p.locator(".ctl-stage img").nth(i).evaluate((img) => img.complete && img.naturalWidth > 0));
    }
    report[`${name} off`] = await p.locator("#ctl-technology").evaluate((root, loaded) => {
      const stages = [...root.querySelectorAll(".ctl-stage")].map((s, i) => {
        const fig = s.querySelector(".ctl-figure"), text = s.querySelector(".ctl-text");
        const r = text.getBoundingClientRect();
        return { figure: getComputedStyle(fig).opacity, figureVis: getComputedStyle(fig).visibility, text: getComputedStyle(text).opacity, title: s.querySelector("h3").textContent, body: s.querySelector(".ctl-stage-body").textContent.length > 0, top: Math.round(r.top + scrollY), imageLoaded: loaded[i] };
      });
      return { reveal: root.dataset.reveal, sticky: getComputedStyle(root.querySelector(".ctl-sticky")).position, stages, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    }, heights);
    report[`${name} off`].sectionTop = top;
    await c.close();
  }
  // Script on: the animation's values at fixed scroll positions.
  {
    const c = await b.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
    const p = await c.newPage();
    await p.goto(url, { waitUntil: "load" });
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const read = () => p.evaluate(() => ({
      images: [...document.querySelectorAll(".ctl-figure")].map((e) => +(+getComputedStyle(e).opacity).toFixed(3)),
      scales: [...document.querySelectorAll(".ctl-image")].map((e) => getComputedStyle(e).transform),
      texts: [...document.querySelectorAll(".ctl-text")].map((e) => +(+getComputedStyle(e).opacity).toFixed(3)),
      textTransforms: [...document.querySelectorAll(".ctl-text")].map((e) => getComputedStyle(e).transform),
      visible: [...document.querySelectorAll(".ctl-stage")].map((e) => e.dataset.visible),
      reveal: document.querySelector(".ctl").dataset.reveal,
      height: document.querySelector(".ctl").offsetHeight,
    }));
    const samples = {};
    if (touch) {
      await p.evaluate(() => window.scrollTo({ top: document.querySelector("#ctl-technology").getBoundingClientRect().top + scrollY - 1500, behavior: "instant" }));
      await p.waitForTimeout(1300);
      samples.beforeReveal = await read();
      for (let i = 0; i < 3; i++) {
        await p.locator(".ctl-stage").nth(i).evaluate((e) => window.scrollTo({ top: e.getBoundingClientRect().top + scrollY - 80, behavior: "instant" }));
        await p.waitForTimeout(1400);
        samples[`stage${i + 1}`] = await read();
        if (shots) await p.screenshot({ path: `${shots}/js-acik-${name}-asama-${i + 1}.png` });
      }
    } else {
      for (const f of [0, 0.14, 0.35, 0.52, 0.69, 0.9, 1]) {
        await p.evaluate((f) => { const s = document.querySelector("#ctl-technology"); window.scrollTo({ top: s.getBoundingClientRect().top + scrollY + f * (s.offsetHeight - innerHeight), behavior: "instant" }); }, f);
        await p.waitForTimeout(1900);
        samples[`p${f}`] = await read();
        if (shots && [0.14, 0.52, 0.9].includes(f)) await p.screenshot({ path: `${shots}/js-acik-${name}-p${f}.png` });
      }
    }
    report[`${name} on`] = samples;
    await c.close();
  }
}
await b.close();
fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
