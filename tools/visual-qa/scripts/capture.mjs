// Records the hero in real time with a steady wheel scroll, and takes stage stills.
// Usage: node capture.mjs <base-url> <review-dir>
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [base = "http://localhost:3110", dir = ".."] = process.argv.slice(2);
const VIEW = { width: 1440, height: 900 };
const browser = await chromium.launch({ channel: "chrome", headless: true });
// Screencast frames follow the real window, not an emulated viewport, so recording
// uses a window sized to give a 1440x900 page (the browser UI takes 87 px).
const recorder = await chromium.launch({ channel: "chrome", headless: true, args: ["--window-size=1440,987"] });
const stats = {};

async function record(route, file, seconds) {
  const context = await recorder.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
  const inner = await page.evaluate(() => [innerWidth, innerHeight]);
  if (inner[0] !== VIEW.width || inner[1] !== VIEW.height) throw new Error(`Recording page is ${inner}, expected 1440x900`);
  await page.mouse.move(VIEW.width / 2, VIEW.height / 2);
  const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hero-cap-"));
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const name = `${String(frames.length).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(tmp, name), Buffer.from(data, "base64"));
    frames.push({ name, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });

  await page.waitForTimeout(2000); // hold on the opening frame
  const stepMs = 33;
  const steps = Math.round((seconds * 1000) / stepMs);
  const t0 = Date.now();
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, range / steps);
    const wait = t0 + (i + 1) * stepMs - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  await page.waitForTimeout(3500); // hold on the final frame
  await cdp.send("Page.stopScreencast");
  const finalY = await page.evaluate(() => Math.round(scrollY));

  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.t ?? f.t + 1 / 30;
    return `file '${path.join(tmp, f.name)}'\nduration ${Math.max(next - f.t, 0.001).toFixed(4)}`;
  });
  list.push(`file '${path.join(tmp, frames.at(-1).name)}'`);
  const listFile = path.join(tmp, "list.txt");
  fs.writeFileSync(listFile, list.join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart", "-an", path.join(dir, file)]);
  stats[file] = { firstFrameBytes: fs.statSync(path.join(tmp, frames[0].name)).size, capturedFrames: frames.length, durationS: +(frames.at(-1).t - frames[0].t).toFixed(1), scrollPx: range, finalY };
  fs.rmSync(tmp, { recursive: true, force: true });
  await context.close();
}

await record("/demo/iccsyn-hero", "hero-desktop-standart.mp4", 8);
await record("/demo/iccsyn-hero-compact", "hero-desktop-kisa.mp4", 7);

// Stage stills, as a share of the section scroll.
const stages = [
  ["01-baslangic.png", 0],
  ["02-metin-cozulmesi.png", 0.15],
  ["03-cam-kabin-belirmesi.png", 0.22],
  ["04-kartlarin-acilmasi.png", 0.42],
  ["05-final-cta.png", 1],
];
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`${base}/demo/iccsyn-hero`, { waitUntil: "networkidle" });
const range = await page.evaluate(() => document.querySelector("section").offsetHeight - innerHeight);
for (const [file, p] of stages) {
  const fraction = p;
  await page.evaluate((y) => { document.documentElement.scrollTop = y; }, range * fraction);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(dir, "ekran-goruntuleri", file) });
}
await context.close();
await browser.close();
await recorder.close();
console.log(JSON.stringify(stats, null, 1));
