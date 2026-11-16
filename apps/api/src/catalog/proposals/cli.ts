/**
 * DP-171: content proposal import command line. Dry run by default (reads only, prints the plan);
 * writes only with --apply and --confirm <n>, where n is the CREATE count the dry run printed.
 *
 *   node dist/catalog/proposals/cli.js --dataset <file.json> [--report <file>] [--only CODE,CODE]
 *        [--apply --confirm <n>]
 *
 * Environment (never on the command line): DP_IMPORT_API_URL, DP_PROXY_KEY_ADMIN,
 * DP_IMPORT_SESSION_TOKEN (the operator's own admin session), DP_IMPORT_ORIGIN (default
 * DP_ADMIN_BASE_URL). Existing proposals are never overwritten.
 *
 * DP-180: `apply-text` copies the proposals' customer text into the listing texts (see
 * apply-text.ts). Dry run by default; writes only with --apply and --confirm <n>, where n is the
 * APPLY count the dry run printed. Same environment.
 *
 *   node dist/catalog/proposals/cli.js apply-text [--site BV] [--locale en] [--report <file>]
 *        [--only CODE,CODE] [--apply --confirm <n>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ProposalDatasetSchema } from "@dream/contracts";
import { adminApi } from "../import/client.js";
import { runApplyText } from "./apply-text.js";
import { runProposals, sha256Hex } from "./import.js";

interface Args {
  dataset: string;
  report: string | null;
  only: Set<string> | null;
  apply: boolean;
  confirm: number | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { dataset: "", report: null, only: null, apply: false, confirm: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--dataset":
        a.dataset = next();
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
        throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  if (!a.dataset) throw new Error("--dataset <file> is required");
  if (a.confirm !== undefined && !a.apply) throw new Error("--confirm is only valid with --apply");
  return a;
}

export interface ApplyTextArgs {
  site: string;
  locale: string;
  report: string | null;
  only: Set<string> | null;
  apply: boolean;
  confirm: number | undefined;
}

/** DP-180: arguments of `apply-text` (after the subcommand). */
export function parseApplyTextArgs(argv: readonly string[]): ApplyTextArgs {
  const a: ApplyTextArgs = {
    site: "BV",
    locale: "en",
    report: null,
    only: null,
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
      case "--site":
        a.site = next();
        break;
      case "--locale":
        a.locale = next();
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
        throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  if (a.confirm !== undefined && !a.apply) throw new Error("--confirm is only valid with --apply");
  if (a.apply && a.confirm === undefined) throw new Error("--apply needs --confirm <n>");
  return a;
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function api() {
  return adminApi({
    baseUrl: env("DP_IMPORT_API_URL"),
    proxyKey: env("DP_PROXY_KEY_ADMIN"),
    sessionToken: env("DP_IMPORT_SESSION_TOKEN"),
    origin: process.env["DP_IMPORT_ORIGIN"] ?? env("DP_ADMIN_BASE_URL"),
  });
}

async function applyText(argv: readonly string[]): Promise<number> {
  const args = parseApplyTextArgs(argv);
  const report = await runApplyText(
    api(),
    {
      siteKey: args.site,
      locale: args.locale,
      only: args.only,
      apply: args.apply,
      confirm: args.confirm,
    },
    (l) => process.stderr.write(`${l}\n`),
  );
  const out = JSON.stringify(report, null, 2);
  if (args.report) writeFileSync(args.report, `${out}\n`);
  process.stdout.write(
    `${report.mode}: ${Object.entries(report.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}; applied ${report.applied.length}\n`,
  );
  if (report.error) {
    process.stderr.write(`error: ${report.error}\n`);
    return 1;
  }
  return report.counts.STALE > 0 ? 2 : 0;
}

async function main(): Promise<number> {
  if (process.argv[2] === "apply-text") return applyText(process.argv.slice(3));
  const args = parseArgs(process.argv.slice(2));
  const bytes = readFileSync(args.dataset);
  const dataset = ProposalDatasetSchema.parse(JSON.parse(bytes.toString("utf8")));
  const report = await runProposals(
    api(),
    dataset,
    sha256Hex(bytes),
    { only: args.only, apply: args.apply, confirm: args.confirm },
    (l) => process.stderr.write(`${l}\n`),
  );
  const out = JSON.stringify(report, null, 2);
  if (args.report) writeFileSync(args.report, `${out}\n`);
  process.stdout.write(
    `${report.mode}: ${Object.entries(report.counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}; created ${report.created.length}\n`,
  );
  if (report.error) {
    process.stderr.write(`error: ${report.error}\n`);
    return 1;
  }
  return 0;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("/catalog/proposals/cli.js")) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
