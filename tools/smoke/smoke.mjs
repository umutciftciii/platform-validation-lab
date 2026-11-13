// HTTP smoke test for the running Compose stack.
//   node tools/smoke/smoke.mjs [--report tools/smoke/output/smoke.json]
// Checks: health endpoints, the BV CMS home page, demo redirects and preview headers, every file
// in apps/web-bv/public (status + SHA-256 against the repo copy), media referenced by the
// rendered BV pages,
// the web-corporate skeleton home page, the admin console's sign-in gate and the clickjacking
// headers of the admin console and the API (DP-014), the privacy pages and lead form texts
// (DP-095), and in DEV the HTTPS proxy (DP-119).
import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import net from "node:net";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS } from "./ports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportArg = process.argv.indexOf("--report");
const reportPath = reportArg > -1 ? process.argv[reportArg + 1] : null;

// SMOKE_HOST lets the test run inside a container (stack.sh smoke uses host.docker.internal).
const HOST = process.env.SMOKE_HOST ?? "127.0.0.1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const base = (service) => `http://${HOST}:${PORTS[service]}`;
const results = [];
const record = (group, name, ok, detail = "") => {
  results.push({ group, name, ok, detail });
  if (!ok) console.log(`FAIL [${group}] ${name} ${detail}`);
};

async function get(url, init) {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
}

// 1. Health
const health = [
  ["web-bv", "/api/health"],
  ["web-corporate", "/api/health"],
  ["admin", "/api/health"],
  ["api", "/health"],
  ["api", "/health/ready"],
];
for (const [service, p] of health) {
  try {
    const res = await get(base(service) + p);
    const body = await res.json();
    record(
      "health",
      `${service}${p}`,
      res.status === 200 && body.status === "ok",
      `HTTP ${res.status} ${JSON.stringify(body.checks ?? body.status)}`,
    );
  } catch (e) {
    record("health", `${service}${p}`, false, String(e));
  }
}

// 1b. Staff-auth trust boundary (F1-002 Group 2). Requests that never reach the database, so the
// smoke test writes nothing (no login attempt, no throttle row, no audit event):
//  - the API without a proxy key answers 404 on /api/v1 (AC-PX-1);
//  - through the admin proxy, an empty login body is a 400 VALIDATION_FAILED from the API, which
//    proves the Route Handler adds the admin key and the API accepts it;
//  - the admin proxy does not forward member routes (allowlist);
//  - a cross-site POST through the proxy is rejected by the API's CSRF check.
const boundary = [
  ["api without key", base("api") + "/api/v1/auth/staff/session", {}, 404, "NOT_FOUND"],
  [
    "admin proxy -> API (key added)",
    base("admin") + "/api/v1/auth/staff/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3112" },
      body: "{}",
    },
    400,
    "VALIDATION_FAILED",
  ],
  ["admin proxy allowlist", base("admin") + "/api/v1/auth/member/login", {}, 404, "NOT_FOUND"],
  [
    "admin proxy -> API CSRF",
    base("admin") + "/api/v1/auth/staff/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: "{}",
    },
    403,
    "AUTH_CSRF_REJECTED",
  ],
];
for (const [name, url, init, status, code] of boundary) {
  try {
    const res = await get(url, init);
    const body = await res.json().catch(() => ({}));
    record(
      "auth-boundary",
      name,
      res.status === status && body?.error?.code === code,
      `HTTP ${res.status} ${body?.error?.code ?? ""}`,
    );
  } catch (e) {
    record("auth-boundary", name, false, String(e));
  }
}

const pages = {};
// 2. BV routes (CMS S2, DP-134): "/" renders the CMS home page (or its unavailable state when
// nothing is published; never content from code); the former demo routes redirect to "/".
for (const route of [
  "/demo/iccsyn-hero",
  "/demo/iccsyn-hero-compact",
  "/demo/iccsyn-hero-nav",
  "/demo/iccsyn-hero-products",
]) {
  try {
    const res = await get(base("web-bv") + route);
    const loc = new URL(res.headers.get("location") ?? "x:", base("web-bv")).pathname;
    record(
      "bv-route",
      `${route} -> /`,
      [307, 308].includes(res.status) && loc === "/",
      `HTTP ${res.status} ${loc}`,
    );
  } catch (e) {
    record("bv-route", route, false, String(e));
  }
}
try {
  const res = await get(base("web-bv") + "/");
  const html = await res.text();
  pages["/"] = html;
  const known = /ICCSYN|This page is not available|cannot be shown right now/.test(html);
  record(
    "bv-route",
    "/ (CMS home)",
    res.status === 200 && known,
    `HTTP ${res.status} ${html.length} B`,
  );
} catch (e) {
  record("bv-route", "/ (CMS home)", false, String(e));
}
// Preview links: never cached or indexed; an invalid token shows nothing.
try {
  const res = await get(base("web-bv") + "/preview/not-a-token");
  const html = await res.text();
  record(
    "bv-route",
    "/preview/<invalid> no-store, noindex",
    (res.headers.get("cache-control") ?? "").includes("no-store") &&
      (res.headers.get("x-robots-tag") ?? "").includes("noindex") &&
      /This page is not available/.test(html),
    `HTTP ${res.status} ${res.headers.get("cache-control")} ${res.headers.get("x-robots-tag")}`,
  );
} catch (e) {
  record("bv-route", "/preview/<invalid>", false, String(e));
}
// The public CMS API answers only with a site proxy key.
try {
  const res = await get(base("api") + "/api/v1/public/cms/page?path=/");
  record("bv-route", "api public cms without key -> 404", res.status === 404, `HTTP ${res.status}`);
} catch (e) {
  record("bv-route", "api public cms without key", false, String(e));
}

// 3. Every public file, byte-identical to the repo copy
const publicDir = path.join(ROOT, "apps/web-bv/public");
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const files = walk(publicDir).filter((f) => !f.endsWith(".DS_Store"));
await Promise.all(
  files.map(async (file) => {
    const rel = "/" + path.relative(publicDir, file).split(path.sep).join("/");
    try {
      const res = await get(base("web-bv") + encodeURI(rel));
      const buf = Buffer.from(await res.arrayBuffer());
      const same = sha(buf) === sha(readFileSync(file));
      record(
        "bv-public",
        rel,
        res.status === 200 && same,
        `HTTP ${res.status}${same ? "" : " sha mismatch"}`,
      );
    } catch (e) {
      record("bv-public", rel, false, String(e));
    }
  }),
);

// 4. Media referenced by rendered pages (incl. next/image URLs)
const refs = new Set();
for (const html of Object.values(pages)) {
  for (const m of html.matchAll(/(?:src|href|srcSet|srcset|poster)="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0].replaceAll("&amp;", "&");
      if (
        url.startsWith("/media/") ||
        url.startsWith("/_next/image") ||
        url.startsWith("/_next/static/media")
      )
        refs.add(url);
    }
  }
}
await Promise.all(
  [...refs].map(async (url) => {
    try {
      const res = await get(base("web-bv") + url);
      await res.arrayBuffer();
      record("bv-referenced", url, res.status === 200, `HTTP ${res.status}`);
    } catch (e) {
      record("bv-referenced", url, false, String(e));
    }
  }),
);

// 5. Skeleton home page (web-corporate)
try {
  const res = await get(base("web-corporate") + "/");
  record("skeleton", "web-corporate /", res.status === 200, `HTTP ${res.status}`);
} catch (e) {
  record("skeleton", "web-corporate /", false, String(e));
}

// 5b. Privacy policy (DP-095 D-T5) on both sites, and the current lead form texts (D-T7). Local
// stacks run as DP_DEPLOY_ENV=local, where the draft is shown with its banner.
for (const service of ["web-bv", "web-corporate"]) {
  try {
    const res = await get(base(service) + "/privacy");
    const html = await res.text();
    record(
      "privacy",
      `${service} /privacy`,
      res.status === 200 && html.includes("Privacy Policy") && html.includes("Who is responsible"),
      `HTTP ${res.status}`,
    );
  } catch (e) {
    record("privacy", `${service} /privacy`, false, String(e));
  }
}
try {
  const res = await get(base("web-bv") + "/lead-form/texts");
  const body = await res.json().catch(() => null);
  record(
    "privacy",
    "web-bv /lead-form/texts",
    res.status === 200 &&
      /\.en$/.test(body?.privacyNotice?.version ?? "") &&
      res.headers.get("cache-control") === "no-store",
    `HTTP ${res.status}`,
  );
} catch (e) {
  record("privacy", "web-bv /lead-form/texts", false, String(e));
}

// 6. Admin console gate (DP-U): signed out, protected pages redirect to /login, which renders.
for (const p of ["/", "/staff", "/products", "/products/categories"]) {
  try {
    const res = await get(base("admin") + p);
    const location = res.headers.get("location") ?? "";
    const ok = res.status === 307 && new URL(location, base("admin")).pathname === "/login";
    record("admin-gate", `admin ${p} -> /login`, ok, `HTTP ${res.status} ${location}`);
  } catch (e) {
    record("admin-gate", `admin ${p} -> /login`, false, String(e));
  }
}
try {
  const res = await get(base("admin") + "/login");
  record("admin-gate", "admin /login", res.status === 200, `HTTP ${res.status}`);
} catch (e) {
  record("admin-gate", "admin /login", false, String(e));
}
// PM-1: the catalogue API answers 401 without a session (through the admin proxy).
try {
  const res = await get(base("admin") + "/api/v1/admin/catalog/context");
  record("admin-gate", "admin catalogue API -> 401", res.status === 401, `HTTP ${res.status}`);
} catch (e) {
  record("admin-gate", "admin catalogue API -> 401", false, String(e));
}

// 6b. PM-3: public product content. The API's public routes need a site key (404 without);
// the BV site renders its product list from them (an empty catalogue is fine), unknown products
// are 404, and image paths reject anything but a published image.
try {
  const res = await get(base("api") + "/api/v1/public/catalog/products");
  record(
    "catalog-public",
    "api public route without key -> 404",
    res.status === 404,
    `HTTP ${res.status}`,
  );
} catch (e) {
  record("catalog-public", "api public route without key -> 404", false, String(e));
}
try {
  const res = await get(base("web-bv") + "/products");
  const html = await res.text();
  record(
    "catalog-public",
    "web-bv /products",
    res.status === 200 && /Products/.test(html) && !/not available right now/.test(html),
    `HTTP ${res.status} ${html.length} B`,
  );
} catch (e) {
  record("catalog-public", "web-bv /products", false, String(e));
}
for (const [p, ok] of [
  ["/product-images/not-an-id/display", [404]],
  ["/product-images/0190f2a1-0000-7000-8000-000000000000/original", [404]],
  ["/product-images/0190f2a1-0000-7000-8000-000000000000/display", [404]],
]) {
  try {
    const res = await get(base("web-bv") + p);
    record("catalog-public", `web-bv ${p}`, ok.includes(res.status), `HTTP ${res.status}`);
  } catch (e) {
    record("catalog-public", `web-bv ${p}`, false, String(e));
  }
}

// 7. Clickjacking (DP-014): admin pages, redirects, 404s, static files and proxy responses, and
// the API itself, must refuse to be framed.
const framePaths = [
  ["admin", "/"],
  ["admin", "/login"],
  ["admin", "/does-not-exist"],
  ["admin", "/api/health"],
  ["admin", "/api/v1/auth/staff/session"],
  ["admin", "/brand/dream-petroleum-mark.svg"],
  ["api", "/health"],
  ["api", "/api/v1/unknown"],
];
for (const [service, p] of framePaths) {
  try {
    const res = await get(base(service) + p);
    const xfo = res.headers.get("x-frame-options") ?? "";
    const csp = res.headers.get("content-security-policy") ?? "";
    const ok = xfo === "DENY" && /(^|;\s*)frame-ancestors 'none'(;|$)/.test(csp);
    const hint =
      !ok && service === "admin" && res.status === 200
        ? " (DEV: next dev may run on a half-written next.config.ts, DP-084; run `stack.sh dev restart admin`)"
        : "";
    record("frame", `${service} ${p}`, ok, `HTTP ${res.status} xfo=${xfo} csp=${csp}${hint}`);
  } catch (e) {
    record("frame", `${service} ${p}`, false, String(e));
  }
}

// 8. DEV HTTPS proxy (DP-119): only when something listens on the admin-tls port (DEV mode;
// production-mode stacks have no such service). The smoke container does not trust the DEV CA,
// so the certificate is checked by hand: issued by Caddy's local CA for admin.localhost. Then the
// proxy must pass the console through with its frame protection and Secure sign-in cookies.
const tlsUp = await new Promise((resolve) => {
  const socket = net.connect({ host: HOST, port: PORTS["admin-tls"] });
  socket.setTimeout(2_000);
  socket.once("connect", () => (socket.destroy(), resolve(true)));
  socket.once("timeout", () => (socket.destroy(), resolve(false)));
  socket.once("error", () => resolve(false));
});
const tlsGet = (p) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        port: PORTS["admin-tls"],
        path: p,
        servername: "admin.localhost",
        headers: { host: `admin.localhost:${PORTS["admin-tls"]}` },
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const cert = res.socket.getPeerX509Certificate?.() ?? null;
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, cert }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
if (tlsUp) {
  try {
    const res = await tlsGet("/login");
    const cert = res.cert instanceof X509Certificate ? res.cert : null;
    record(
      "admin-tls",
      "certificate for admin.localhost from the DEV local CA",
      Boolean(
        cert && /Caddy Local Authority/.test(cert.issuer) && cert.checkHost("admin.localhost"),
      ),
      cert ? `issuer=${cert.issuer.replace(/\n/g, ", ")}` : "no certificate",
    );
    const xfo = res.headers["x-frame-options"] ?? "";
    record(
      "admin-tls",
      "/login through the proxy",
      res.status === 200 && xfo === "DENY",
      `HTTP ${res.status} xfo=${xfo}`,
    );
    const enrol = await tlsGet("/enrol");
    record(
      "admin-tls",
      "/enrol no-referrer, no-store",
      enrol.status === 200 &&
        enrol.headers["referrer-policy"] === "no-referrer" &&
        /no-store/.test(String(enrol.headers["cache-control"] ?? "")),
      `HTTP ${enrol.status}`,
    );
  } catch (e) {
    record("admin-tls", "https://admin.localhost", false, String(e));
  }
} else {
  console.log(`admin-tls: nothing on port ${PORTS["admin-tls"]} (production mode); skipped`);
}

// Summary
const groups = {};
for (const r of results) {
  groups[r.group] ??= { pass: 0, fail: 0 };
  groups[r.group][r.ok ? "pass" : "fail"] += 1;
}
for (const [g, c] of Object.entries(groups))
  console.log(`${g.padEnd(14)} pass ${c.pass}  fail ${c.fail}`);
const failed = results.filter((r) => !r.ok).length;
if (reportPath) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({ time: new Date().toISOString(), groups, results }, null, 2),
  );
}
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
