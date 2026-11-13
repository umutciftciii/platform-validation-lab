#!/usr/bin/env node
// NT-P11 / AC-PX-7 (F1-002 Group 2): the admin build output must not contain the proxy key.
//
//   DP_PROXY_KEY_ADMIN=<canary> next build && node scripts/scan-build-for-secrets.mjs <canary>
//
// CI builds the admin app with a random canary as DP_PROXY_KEY_ADMIN in the build environment and
// then scans everything Next wrote (.next, without its cache): the client bundle (.next/static),
// the server output and the prerendered pages. Next only inlines NEXT_PUBLIC_* variables, so a
// hit means someone exposed the key; the script also refuses any NEXT_PUBLIC_ name that mentions
// a proxy key or the API URL in the admin sources. The canary itself is never printed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canary = process.argv[2] ?? "";
if (!/^[A-Za-z0-9_-]{43,}$/.test(canary)) {
  console.error("scan: pass the canary key (at least 43 base64url characters) as the argument");
  process.exit(2);
}

function* files(dir, skip) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (skip(p)) continue;
    if (entry.isDirectory()) yield* files(p, skip);
    else if (entry.isFile()) yield p;
  }
}

const next = path.join(root, ".next");
try {
  statSync(path.join(next, "static"));
} catch {
  console.error("scan: .next/static is missing; run next build first");
  process.exit(2);
}

let scanned = 0;
const hits = [];
for (const file of files(next, (p) => p.startsWith(path.join(next, "cache")))) {
  scanned++;
  if (readFileSync(file).includes(canary)) hits.push(path.relative(root, file));
}

const sourceHits = [];
const sourceSkip = (p) => /node_modules|\.next|scripts$/.test(p);
for (const file of files(root, sourceSkip)) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/NEXT_PUBLIC_[A-Z_]*(PROXY|KEY|API_URL|SECRET)/.test(text))
    sourceHits.push(path.relative(root, file));
}

if (hits.length || sourceHits.length) {
  for (const h of hits) console.error(`scan: proxy key found in build output: ${h}`);
  for (const h of sourceHits) console.error(`scan: NEXT_PUBLIC_ variable for a secret in: ${h}`);
  process.exit(1);
}
console.log(`scan: ${scanned} build files checked; the proxy key is in none of them`);
