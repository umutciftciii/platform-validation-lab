/**
 * Operator CLI for IAM (F1-001, ADR-012A). Runs from the compiled API (`node dist/iam/iam-cli.js`).
 *
 *   iam-cli.js matrix
 *       Print the RBAC permission matrix (no database).
 *   iam-cli.js sync --confirm-database <name>
 *       Mirror the code catalogue into the database. Connects with MIGRATE_DATABASE_URL
 *       (dp_migrator, acting as dp_owner): the API's role may only read the catalogue.
 *   iam-cli.js bootstrap --email <address> [--name <display name>] --confirm-database <name>
 *       Create the first platform administrator (once; no password; ADR-011). Connects with
 *       IAM_BOOTSTRAP_DATABASE_URL (dp_iam_bootstrap), a credential the API never holds.
 *   iam-cli.js enrol-link --email <address> --confirm-database <name>
 *       Activation link of the bootstrap administrator (30 min, single use; F1-002 Group 2).
 *   iam-cli.js reset-link --email <address> --confirm-database <name>
 *       Staff password-reset link (30 min); the reset still needs the user's TOTP or a
 *       recovery code.
 *   iam-cli.js recover-admin --email <address> --reason <text> --confirm-database <name>
 *       Last resort: the only qualified platform administrator lost password and MFA. Clears both
 *       and prints a recovery link (docs/security/operator-recovery.md).
 *   iam-cli.js cleanup --confirm-database <name>
 *       One retention clean-up round (sessions, tokens, unconfirmed factors, throttle buckets).
 *   The four commands above connect with DATABASE_URL (dp_app, the API's role); links use
 *   DP_ADMIN_BASE_URL and are printed once, to stdout only. None of them works on the system
 *   owner's account (DP-108: refused here and by the database).
 *   iam-cli.js owner-designate --email <address> --reason <text> --confirm-database <name>
 *       DP-108: start the one-time designation of the system owner; prints a confirmation link
 *       (30 min) for the admin app (password + MFA step-up). Refused once an owner exists.
 *   iam-cli.js owner-recover --email <address> --reason <text> --confirm-database <name>
 *       DP-108: the system owner lost password and MFA; clears both and prints a recovery link.
 *   iam-cli.js owner-status --confirm-database <name>
 *       DP-108: whether a system owner is designated (masked e-mail).
 *   The three owner commands connect with IAM_BOOTSTRAP_DATABASE_URL (dp_iam_bootstrap) only: the
 *   owner's recovery authority is never in the API's database identity (ADR-018).
 *
 * Each command reads only its own variable and checks the database identity it got, so neither
 * the API's DATABASE_URL nor a superuser URL can be used by mistake. Database commands refuse to
 * run unless --confirm-database equals the database the URL points to, so a mistyped URL cannot
 * touch another environment. Nothing secret is printed.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { runAuthCleanup } from "./auth/cleanup.js";
import { bootstrapPlatformAdmin, databaseIdentity } from "./bootstrap.js";
import { parseOrigin, type DeployEnv } from "./http/api-config.js";
import { operatorEnrolLink, operatorRecoverAdmin, operatorResetLink } from "./operator.js";
import { designateOwner, ownerStatus, recoverOwner } from "./owner/operator.js";
import { syncCatalog } from "./catalog-sync.js";
import { renderPermissionMatrix } from "./matrix.js";

/** Which credential each database command uses, and the role it must end up as (ADR-012A). */
const CLI_DATABASE = {
  sync: {
    urlVariable: "MIGRATE_DATABASE_URL",
    currentUser: "dp_owner",
    sessionUser: "dp_migrator",
  },
  bootstrap: {
    urlVariable: "IAM_BOOTSTRAP_DATABASE_URL",
    currentUser: "dp_iam_bootstrap",
    sessionUser: "dp_iam_bootstrap",
  },
  "enrol-link": { urlVariable: "DATABASE_URL", currentUser: "dp_app", sessionUser: "dp_app" },
  "reset-link": { urlVariable: "DATABASE_URL", currentUser: "dp_app", sessionUser: "dp_app" },
  "recover-admin": { urlVariable: "DATABASE_URL", currentUser: "dp_app", sessionUser: "dp_app" },
  cleanup: { urlVariable: "DATABASE_URL", currentUser: "dp_app", sessionUser: "dp_app" },
  "owner-designate": {
    urlVariable: "IAM_BOOTSTRAP_DATABASE_URL",
    currentUser: "dp_iam_bootstrap",
    sessionUser: "dp_iam_bootstrap",
  },
  "owner-recover": {
    urlVariable: "IAM_BOOTSTRAP_DATABASE_URL",
    currentUser: "dp_iam_bootstrap",
    sessionUser: "dp_iam_bootstrap",
  },
  "owner-status": {
    urlVariable: "IAM_BOOTSTRAP_DATABASE_URL",
    currentUser: "dp_iam_bootstrap",
    sessionUser: "dp_iam_bootstrap",
  },
} as const;

function adminBaseUrl(): string {
  const deployEnv = (process.env["DP_DEPLOY_ENV"]?.trim() || "local") as DeployEnv;
  return parseOrigin(
    process.env["DP_ADMIN_BASE_URL"]?.trim() || "https://admin.dreampetroleum.com",
    "DP_ADMIN_BASE_URL",
    deployEnv,
  );
}

type DbCommand = keyof typeof CLI_DATABASE;

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i > -1 ? argv[i + 1] : undefined;
}

async function connect(argv: string[], command: DbCommand): Promise<PrismaClient> {
  const expected = CLI_DATABASE[command];
  const url = process.env[expected.urlVariable] ?? "";
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error(`${expected.urlVariable} is not set or not a valid URL`);
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
    if (who.currentUser !== expected.currentUser || who.sessionUser !== expected.sessionUser) {
      throw new Error(
        `refusing: ${command} must run as ${expected.sessionUser} (current_user ${expected.currentUser}), ` +
          `got ${who.sessionUser} (current_user ${who.currentUser}); check ${expected.urlVariable}`,
      );
    }
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  return prisma;
}

const USAGE =
  "usage: iam-cli.js matrix | sync --confirm-database <db> | bootstrap --email <e> --confirm-database <db>" +
  " | enrol-link --email <e> --confirm-database <db> | reset-link --email <e> --confirm-database <db>" +
  " | recover-admin --email <e> --reason <text> --confirm-database <db> | cleanup --confirm-database <db>" +
  " | owner-designate --email <e> --reason <text> --confirm-database <db>" +
  " | owner-recover --email <e> --reason <text> --confirm-database <db> | owner-status --confirm-database <db>";

function isDbCommand(command: string | undefined): command is DbCommand {
  return command !== undefined && Object.hasOwn(CLI_DATABASE, command);
}

async function main(argv: string[]): Promise<void> {
  const [command] = argv;
  if (command === "matrix") {
    process.stdout.write(renderPermissionMatrix());
    return;
  }
  if (!isDbCommand(command)) throw new Error(USAGE);
  const email = arg(argv, "--email");
  if (command !== "sync" && command !== "cleanup" && command !== "owner-status" && !email)
    throw new Error(`${command} needs --email`);
  const base =
    command === "sync" ||
    command === "bootstrap" ||
    command === "cleanup" ||
    command === "owner-status"
      ? ""
      : adminBaseUrl();
  const prisma = await connect(argv, command);
  try {
    switch (command) {
      case "sync":
        console.log(JSON.stringify(await syncCatalog(prisma)));
        break;
      case "bootstrap": {
        const name = arg(argv, "--name");
        const result = await bootstrapPlatformAdmin(prisma, {
          email: email as string,
          ...(name ? { displayName: name } : {}),
        });
        console.log(
          `platform administrator assigned (user ${result.userId}, ${result.createdUser ? "new" : "existing"} account, status PENDING until enrolment: iam-cli enrol-link)`,
        );
        break;
      }
      case "enrol-link":
        console.log(
          `activation link (30 min, single use; deliver out of band): ${await operatorEnrolLink(prisma, email as string, base)}`,
        );
        break;
      case "reset-link":
        console.log(
          `password-reset link (30 min, single use; needs the user's TOTP or a recovery code): ${await operatorResetLink(prisma, email as string, base)}`,
        );
        break;
      case "recover-admin": {
        const reason = arg(argv, "--reason");
        if (!reason) throw new Error("recover-admin needs --reason");
        console.log(
          `recovery link (30 min, single use; password and MFA must be set up again): ${await operatorRecoverAdmin(prisma, email as string, reason, base)}`,
        );
        break;
      }
      case "owner-designate": {
        const reason = arg(argv, "--reason");
        if (!reason) throw new Error("owner-designate needs --reason");
        console.log(
          `owner designation link (30 min, single use; the person signs in, then confirms with password and MFA step-up): ${await designateOwner(prisma, email as string, reason, base)}`,
        );
        break;
      }
      case "owner-recover": {
        const reason = arg(argv, "--reason");
        if (!reason) throw new Error("owner-recover needs --reason");
        console.log(
          `owner recovery link (30 min, single use; password and MFA must be set up again): ${await recoverOwner(prisma, email as string, reason, base)}`,
        );
        break;
      }
      case "owner-status":
        console.log(await ownerStatus(prisma));
        break;
      case "cleanup":
        console.log(
          JSON.stringify(
            (await runAuthCleanup(prisma)) ?? {
              skipped: "another instance holds the clean-up lock",
            },
          ),
        );
        break;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
