/**
 * Operator CLI for lead retention and erasure (DP-096; ADR-003 §5). Runs from the compiled API
 * (`node dist/leads/leads-cli.js`), through `infra/docker/stack.sh leads …`.
 *
 *   leads-cli.js retention --confirm-database <name> [--apply]
 *       Plan the retention run (default: DRY RUN, nothing changes) or apply it: anonymise leads
 *       past 24 months (not held), clear IP prefix HMACs after 90 days, delete unused grants 30
 *       days after expiry and expired rate-limit buckets. One audit event with counts.
 *   leads-cli.js erase --email <address> --identity-check <ticket> --confirm-database <name> [--apply]
 *       Erasure request (GDPR Art. 17) for every live lead with this e-mail. Dry run unless
 *       --apply. Refused when a lead is held (customer, open opportunity, legal hold): a person
 *       reviews the legal exception first. The identity check is the reference of the reply to
 *       the stored address, never an e-mail address.
 *   leads-cli.js hold --email <address> --site BV|CORPORATE (--set CUSTOMER|OPEN_OPPORTUNITY|LEGAL_HOLD | --clear)
 *         --reference <ticket> --confirm-database <name>
 *       Keep (or release) a lead outside the 24-month rule until the CRM policy decides.
 *
 * Every command connects with IAM_BOOTSTRAP_DATABASE_URL (the operator credential, never held by
 * the API) and does its work as dp_lead_retention (SET LOCAL ROLE); the database limits that role
 * to the anonymisation itself. With DP_DEPLOY_ENV=production (or an unknown value) --apply is
 * refused unless DP_LEAD_RETENTION_PRODUCTION_APPROVAL names the owner's separate approval; the
 * reference is written to the audit trail. Output: counts and outcome codes, never personal data.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { privacyDeployEnv } from "@dream/contracts";
import { PrismaClient } from "../generated/prisma/client.js";
import { databaseIdentity } from "../iam/bootstrap.js";
import {
  CLEARED_FIELDS,
  IDENTITY_CHECK_PATTERN,
  RETAINED_FIELDS,
  RETENTION_HOLDS,
  eraseByEmail,
  runRetention,
  setRetentionHold,
  type RetentionHold,
} from "./retention.js";

const URL_VARIABLE = "IAM_BOOTSTRAP_DATABASE_URL";
const OPERATOR = "dp_iam_bootstrap";

export const LEADS_USAGE =
  "usage: leads-cli.js retention --confirm-database <db> [--apply]" +
  " | erase --email <e> --identity-check <ticket> --confirm-database <db> [--apply]" +
  " | hold --email <e> --site BV|CORPORATE (--set CUSTOMER|OPEN_OPPORTUNITY|LEGAL_HOLD | --clear)" +
  " --reference <ticket> --confirm-database <db>";

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : undefined;
}

/**
 * The production gate of D-R6: real anonymisation in production needs the owner's separate,
 * explicit approval. Returns the approval reference to audit (null outside production).
 */
export function productionApproval(env: NodeJS.ProcessEnv, apply: boolean): string | null {
  if (!apply || privacyDeployEnv(env["DP_DEPLOY_ENV"]) !== "production") return null;
  const ref = env["DP_LEAD_RETENTION_PRODUCTION_APPROVAL"]?.trim() ?? "";
  if (!IDENTITY_CHECK_PATTERN.test(ref) || ref.includes("@")) {
    throw new Error(
      "refusing: --apply in production needs the owner's separate approval " +
        "(DP_LEAD_RETENTION_PRODUCTION_APPROVAL=<approval reference>)",
    );
  }
  return ref;
}

async function connect(argv: string[], env: NodeJS.ProcessEnv): Promise<PrismaClient> {
  const url = env[URL_VARIABLE] ?? "";
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${URL_VARIABLE} is not set or not a valid URL`);
  }
  const confirm = arg(argv, "--confirm-database");
  if (!confirm || confirm !== name) {
    throw new Error(
      `refusing: pass --confirm-database ${name || "<name>"} to act on this database`,
    );
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const who = await databaseIdentity(prisma);
    if (who.currentUser !== OPERATOR || who.sessionUser !== OPERATOR) {
      throw new Error(
        `refusing: leads commands run as ${OPERATOR}, got ${who.sessionUser} (current_user ${who.currentUser}); check ${URL_VARIABLE}`,
      );
    }
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  return prisma;
}

export async function leadsCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const [command] = argv;
  if (command !== "retention" && command !== "erase" && command !== "hold")
    throw new Error(LEADS_USAGE);
  const apply = argv.includes("--apply");
  const approval = command === "hold" ? null : productionApproval(env, apply);
  const now = new Date();

  if (command === "erase") {
    const email = arg(argv, "--email");
    const identityCheck = arg(argv, "--identity-check");
    if (!email || !identityCheck) throw new Error("erase needs --email and --identity-check");
    const prisma = await connect(argv, env);
    try {
      const r = await eraseByEmail(prisma, { email, identityCheck, apply }, now);
      return JSON.stringify({ command, dryRun: !apply, ...r });
    } finally {
      await prisma.$disconnect();
    }
  }

  if (command === "hold") {
    const email = arg(argv, "--email");
    const site = arg(argv, "--site");
    const reference = arg(argv, "--reference");
    const set = arg(argv, "--set");
    const clear = argv.includes("--clear");
    if (!email || !reference || (site !== "BV" && site !== "CORPORATE")) {
      throw new Error("hold needs --email, --site BV|CORPORATE and --reference");
    }
    if ((set === undefined) === !clear)
      throw new Error("hold needs exactly one of --set <hold> or --clear");
    if (set !== undefined && !(RETENTION_HOLDS as readonly string[]).includes(set)) {
      throw new Error(`--set must be one of ${RETENTION_HOLDS.join(", ")}`);
    }
    const prisma = await connect(argv, env);
    try {
      const r = await setRetentionHold(
        prisma,
        { email, siteKey: site, hold: clear ? null : (set as RetentionHold), reference },
        now,
      );
      return JSON.stringify({ command, ...r });
    } finally {
      await prisma.$disconnect();
    }
  }

  const prisma = await connect(argv, env);
  try {
    const r = await runRetention(prisma, now, { apply, productionApproval: approval });
    return JSON.stringify({
      command,
      ...r,
      cleared: CLEARED_FIELDS,
      retainedNotClaimedAnonymous: RETAINED_FIELDS,
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("leads-cli.js")) {
  leadsCli(process.argv.slice(2)).then(
    (out) => console.log(out),
    (error: unknown) => {
      console.error(`leads-cli: ${(error as Error).message}`);
      process.exitCode = 1;
    },
  );
}
