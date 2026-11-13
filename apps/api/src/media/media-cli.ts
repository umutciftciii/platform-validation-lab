/**
 * Operator CLI for the media storage (PM-3). Runs from the compiled API inside the API container
 * (it needs the API's storage configuration and volume):
 *
 *   media-cli.js cleanup --confirm-database <name> [--grace-hours <n>] [--apply]
 *       Finds stored objects that no ProductImage row refers to (orphans) and stray temporary
 *       files older than the grace period (default 24 h). Without --apply it only reports
 *       (dry run). Names that are neither keys nor stray files are reported, never deleted.
 *
 * Connects with DATABASE_URL (dp_app; it only reads ProductImage) and refuses to run unless
 * --confirm-database names the database the URL points to. Prints counts and keys (random
 * names), never file contents or credentials.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { databaseIdentity } from "../iam/bootstrap.js";
import { applyCleanup, DEFAULT_GRACE_HOURS, planCleanup, referencedKeys } from "./cleanup.js";
import { createMediaStorage } from "./config.js";
import { FilesystemStorage } from "./filesystem.js";

const USAGE = "usage: media-cli.js cleanup --confirm-database <db> [--grace-hours <n>] [--apply]";

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] !== "cleanup") throw new Error(USAGE);
  const url = process.env["DATABASE_URL"] ?? "";
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL is not set or not a valid URL");
  }
  if (arg(argv, "--confirm-database") !== name) {
    throw new Error(
      `refusing: pass --confirm-database ${name || "<name>"} to act on this database`,
    );
  }
  const graceRaw = arg(argv, "--grace-hours");
  const grace = graceRaw === undefined ? DEFAULT_GRACE_HOURS : Number(graceRaw);
  if (!Number.isFinite(grace) || grace < 1 || grace > 24 * 365) {
    throw new Error("--grace-hours must be a number from 1 to 8760");
  }
  const apply = argv.includes("--apply");
  const storage = createMediaStorage(process.env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const who = await databaseIdentity(prisma);
    if (who.currentUser !== "dp_app") {
      throw new Error(`refusing: cleanup must run as dp_app, got ${who.currentUser}`);
    }
    // Read the rows first, then list: an image committed after this read has young files, and
    // the grace period keeps them.
    const rows = await prisma.productImage.findMany({
      select: { storageKey: true, variants: true },
    });
    const plan = await planCleanup(storage, referencedKeys(rows), new Date(), grace);
    const report: Record<string, unknown> = {
      mode: apply ? "apply" : "dry-run",
      storage: storage.kind,
      graceHours: grace,
      scanned: plan.scanned,
      referenced: plan.referenced,
      orphans: plan.orphans.length,
      orphanBytes: plan.orphanBytes,
      young: plan.young,
      unknown: plan.unknown.length,
      orphanKeys: plan.orphans.slice(0, 200).map((o) => `${o.kind}:${o.key}`),
    };
    if (apply) {
      Object.assign(report, await applyCleanup(storage, plan));
      if (storage instanceof FilesystemStorage) {
        report["emptyDirsRemoved"] = await storage.pruneEmptyDirs();
      }
    }
    console.log(JSON.stringify(report));
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
