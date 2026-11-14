/**
 * DP-157: catalogue import command line. Dry run by default (reads only, prints the plan);
 * writes only with --apply and --confirm <n>, where n is the "to create or resume" count the dry
 * run printed (so an apply always follows a dry run of the same catalogue state).
 *
 *   node dist/catalog/import/cli.js --mapping <file> [--report <file>] [--only CODE,CODE]
 *        [--resume-partial] [--apply --confirm <n>]
 *   node dist/catalog/import/cli.js --media <manifest.json> [--media-root <dir>] [same options]
 *
 * The media stage (DP-158) runs on its own: it reads the verified DP-158 manifest and uploads
 * images and PDFs through the existing admin API (media.ts). It never links a document to a site.
 *
 * Environment (never on the command line): DP_IMPORT_API_URL, DP_PROXY_KEY_ADMIN,
 * DP_IMPORT_SESSION_TOKEN (the operator's own admin session), DP_IMPORT_ORIGIN (default
 * DP_ADMIN_BASE_URL). Images and documents are never imported by this tool.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CatalogMappingSchema, MediaManifestSchema } from "@dream/contracts";
import { adminApi } from "./client.js";
import { runMedia, type MediaReport } from "./media.js";
import { runImport, type ImportReport } from "./run.js";

interface Args {
  mapping: string;
  media: string;
  mediaRoot: string | null;
  report: string | null;
  only: Set<string> | null;
  resumePartial: boolean;
  apply: boolean;
  confirm: number | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = {
    mapping: "",
    media: "",
    mediaRoot: null,
    report: null,
    only: null,
    resumePartial: false,
    apply: false,
    confirm: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--mapping":
        a.mapping = next();
        break;
      case "--media":
        a.media = next();
        break;
      case "--media-root":
        a.mediaRoot = next();
        break;
      case "--report":
        a.report = next();
        break;
      case "--only":
        a.only = new Set(
          next()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        break;
      case "--resume-partial":
        a.resumePartial = true;
        break;
      case "--apply":
        a.apply = true;
        break;
      case "--confirm": {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 0) throw new Error("--confirm needs a whole number");
        a.confirm = n;
        break;
      }
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!a.mapping && !a.media) throw new Error("--mapping <file> or --media <manifest> is required");
  if (a.mapping && a.media) throw new Error("--mapping and --media are separate stages; run one");
  if (a.mediaRoot && !a.media) throw new Error("--media-root is only used with --media");
  if (a.confirm !== undefined && !a.apply) throw new Error("--confirm is only used with --apply");
  return a;
}

export function summary(r: ImportReport): string {
  const c = r.plan.counts;
  const lines = [
    `mode: ${r.mode} (site ${r.site.key})`,
    `products: ${c.products} | create ${c.create} | resume ${c.resume} | already imported ${c.alreadyImported} | partial ${c.partial} | conflict ${c.conflict}`,
    `specification values: ${c.specValues} to write, ${c.specValuesSkipped} skipped`,
    `definitions to create: ${c.definitionsToCreate} | categories to create: ${c.categoriesToCreate}`,
    ...r.plan.definitions
      .filter((d) => d.action === "CONFLICT")
      .map((d) => `definition conflict ${d.key}: ${d.reason}`),
    ...r.plan.categories
      .filter((x) => x.action === "CONFLICT")
      .map((x) => `category conflict ${x.slug}: ${x.reason}`),
    ...r.plan.products
      .filter((p) => p.action === "CONFLICT" || p.action === "PARTIAL")
      .map((p) => `${p.action.toLowerCase()} ${p.code} (${p.slug}): ${p.reasons.join("; ")}`),
  ];
  if (r.mode === "dry-run") {
    lines.push(
      r.plan.confirmCount > 0
        ? `nothing written. To apply this plan: --apply --confirm ${r.plan.confirmCount}`
        : "nothing written; nothing to apply",
    );
  } else {
    lines.push(`written: ${r.written.length} record(s)`);
    if (r.error) lines.push(`STOPPED: ${r.error}`);
  }
  return lines.join("\n");
}

export function mediaSummary(r: MediaReport): string {
  const c = r.plan.counts;
  const lines = [
    `mode: ${r.mode} (media stage, site BV)`,
    `files: ${c.images} image(s), ${c.pdfs} PDF(s) | create ${c.CREATE} | resume ${c.RESUME} | already imported ${c.ALREADY_IMPORTED} | partial ${c.PARTIAL} | conflict ${c.CONFLICT}`,
    ...r.plan.items
      .filter((i) => i.action === "CONFLICT" || i.action === "PARTIAL")
      .map((i) => `${i.action.toLowerCase()} ${i.kind} ${i.code}: ${i.reason}`),
  ];
  if (r.mode === "dry-run") {
    lines.push(
      r.plan.confirmCount > 0
        ? `nothing written. To apply this plan: --apply --confirm ${r.plan.confirmCount}`
        : "nothing written; nothing to apply",
    );
  } else {
    lines.push(`written: ${r.written.length} record(s)`);
    if (r.error) lines.push(`STOPPED: ${r.error}`);
  }
  return lines.join("\n");
}

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || fallback;
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  const api = adminApi({
    baseUrl: env("DP_IMPORT_API_URL"),
    proxyKey: env("DP_PROXY_KEY_ADMIN"),
    sessionToken: env("DP_IMPORT_SESSION_TOKEN"),
    origin: env("DP_IMPORT_ORIGIN", process.env["DP_ADMIN_BASE_URL"]),
  });
  const common = {
    apply: args.apply,
    ...(args.confirm !== undefined ? { confirm: args.confirm } : {}),
    ...(args.only ? { only: args.only } : {}),
    resumePartial: args.resumePartial,
    log: (l: string) => process.stderr.write(`${l}\n`),
  };
  if (args.media) {
    const manifest = MediaManifestSchema.parse(JSON.parse(readFileSync(args.media, "utf8")));
    const media = await runMedia(api, manifest, args.mediaRoot ?? path.dirname(args.media), common);
    if (args.report) writeFileSync(args.report, `${JSON.stringify(media, null, 2)}\n`);
    process.stdout.write(`${mediaSummary(media)}\n`);
    return media.error ? 3 : 0;
  }
  const mapping = CatalogMappingSchema.parse(JSON.parse(readFileSync(args.mapping, "utf8")));
  const report = await runImport(api, mapping, common);
  if (args.report) writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${summary(report)}\n`);
  return report.error ? 3 : 0;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("/catalog/import/cli.js")) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
