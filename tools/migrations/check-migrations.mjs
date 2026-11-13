// Static safety checks for Prisma migrations (ADR-010). No database needed; runs on Node >= 20.
//
//   node tools/migrations/check-migrations.mjs [--dir apps/api/prisma/migrations] [--base <git-ref>]
//
// Fails (exit 1) when:
//   - a migration folder is not named <14-digit timestamp>_<snake_case>, or has no non-empty
//     migration.sql;
//   - migrations exist but migration_lock.toml is missing or not provider = "postgresql";
//   - a migration contains a data-destroying statement (DROP TABLE/COLUMN/SCHEMA/DATABASE,
//     TRUNCATE, DELETE FROM, ALTER COLUMN ... TYPE, DROP NOT NULL is fine) and its folder has no
//     DESTRUCTIVE_APPROVED.md that states the reason, the backup taken and the reviewer;
//   - with --base: a migration that exists on the base ref was modified, renamed or deleted.
//     Applied migrations are immutable; fixes go into a new migration (roll forward).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = /^\d{14}_[a-z0-9_]+$/;

// Statements that can destroy or rewrite existing data. Comments are stripped before matching.
export const DESTRUCTIVE_PATTERNS = [
  ["DROP TABLE", /\bDROP\s+TABLE\b/i],
  ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
  ["DROP SCHEMA", /\bDROP\s+SCHEMA\b/i],
  ["DROP DATABASE", /\bDROP\s+DATABASE\b/i],
  ["DROP TYPE", /\bDROP\s+TYPE\b/i],
  // A trigger event (`BEFORE TRUNCATE`, `... OR TRUNCATE`) protects data and is not a statement.
  ["TRUNCATE", /(?<!\b(?:BEFORE|AFTER|OR)\s+)\bTRUNCATE\b/i],
  ["DELETE FROM", /\bDELETE\s+FROM\b/i],
  ["ALTER COLUMN ... TYPE", /\bALTER\s+COLUMN\s+("[^"]+"|\w+)\s+(SET\s+DATA\s+)?TYPE\b/i],
  ["RENAME", /\bRENAME\s+(TO|COLUMN)\b/i],
];

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function findDestructive(sql) {
  const body = stripSqlComments(sql);
  return DESTRUCTIVE_PATTERNS.filter(([, re]) => re.test(body)).map(([label]) => label);
}

// An approval file must name the reason, the backup and the reviewer, so it is a decision, not a
// bypass.
export function approvalProblems(text) {
  const missing = [];
  for (const field of ["Reason:", "Backup:", "Reviewed-by:"]) {
    const line = text.split("\n").find((l) => l.trim().startsWith(field));
    if (!line || line.trim().length <= field.length) missing.push(field);
  }
  return missing;
}

export function checkMigrationsDir(dir) {
  const errors = [];
  const notes = [];
  if (!existsSync(dir)) return { errors: [`${dir} does not exist`], notes, migrations: [] };
  const entries = readdirSync(dir).filter((e) => statSync(path.join(dir, e)).isDirectory());
  const migrations = entries.sort();

  for (const name of migrations) {
    const folder = path.join(dir, name);
    if (!NAME.test(name)) errors.push(`${name}: folder name must be <YYYYMMDDHHMMSS>_<snake_case>`);
    const sqlPath = path.join(folder, "migration.sql");
    if (!existsSync(sqlPath)) {
      errors.push(`${name}: migration.sql is missing`);
      continue;
    }
    const sql = readFileSync(sqlPath, "utf8");
    if (!stripSqlComments(sql).trim()) errors.push(`${name}: migration.sql is empty`);
    const destructive = findDestructive(sql);
    if (destructive.length) {
      const approval = path.join(folder, "DESTRUCTIVE_APPROVED.md");
      if (!existsSync(approval)) {
        errors.push(
          `${name}: destructive statement(s) ${destructive.join(", ")} without DESTRUCTIVE_APPROVED.md (ADR-010)`,
        );
      } else {
        const missing = approvalProblems(readFileSync(approval, "utf8"));
        if (missing.length)
          errors.push(`${name}: DESTRUCTIVE_APPROVED.md lacks ${missing.join(", ")}`);
        else notes.push(`${name}: destructive (${destructive.join(", ")}), approved`);
      }
    }
  }

  if (migrations.length) {
    const lock = path.join(dir, "migration_lock.toml");
    if (!existsSync(lock)) errors.push("migration_lock.toml is missing");
    else if (!/provider\s*=\s*"postgresql"/.test(readFileSync(lock, "utf8"))) {
      errors.push('migration_lock.toml must say provider = "postgresql"');
    }
  }
  return { errors, notes, migrations };
}

// Migrations present on `base` must be byte-identical now: no edits, renames or deletions.
export function checkImmutable(dir, base, cwd = process.cwd()) {
  const rel = path.relative(cwd, dir) || ".";
  const out = execFileSync("git", ["diff", "--name-status", "--no-renames", base, "--", rel], {
    cwd,
    encoding: "utf8",
  });
  const errors = [];
  for (const line of out.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (!/\/\d{14}_[^/]+\//.test(`/${file}`)) continue; // only files inside migration folders
    if (status === "A") continue;
    errors.push(
      `${file}: ${status === "D" ? "deleted" : "modified"} after it was committed on ${base}`,
    );
  }
  return errors;
}

function main(argv) {
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i > -1 ? argv[i + 1] : fallback;
  };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = path.resolve(root, arg("--dir", "apps/api/prisma/migrations"));
  const base = arg("--base", null);

  const { errors, notes, migrations } = checkMigrationsDir(dir);
  if (base) errors.push(...checkImmutable(dir, base, root));
  for (const n of notes) console.log(`note: ${n}`);
  console.log(
    `${migrations.length} migration(s) in ${path.relative(root, dir)}${base ? `, compared with ${base}` : ""}`,
  );
  if (errors.length) {
    for (const e of errors) console.error(`FAIL ${e}`);
    process.exit(1);
  }
  console.log("migration checks passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
