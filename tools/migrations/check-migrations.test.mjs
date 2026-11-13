import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  approvalProblems,
  checkImmutable,
  checkMigrationsDir,
  findDestructive,
} from "./check-migrations.mjs";

const dirs = [];
function tempDir() {
  const d = mkdtempSync(path.join(tmpdir(), "migr-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function migration(dir, name, sql, files = {}) {
  mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, name, "migration.sql"), sql);
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, name, f), text);
}
const LOCK = 'provider = "postgresql"\n';

describe("findDestructive", () => {
  it.each([
    ['DROP TABLE "Lead";', "DROP TABLE"],
    ['ALTER TABLE "Lead" DROP COLUMN "email";', "DROP COLUMN"],
    ["TRUNCATE leads;", "TRUNCATE"],
    ["delete from leads where true;", "DELETE FROM"],
    ['ALTER TABLE "Lead" ALTER COLUMN "score" SET DATA TYPE BIGINT;', "ALTER COLUMN ... TYPE"],
    ['ALTER TABLE "Lead" RENAME COLUMN "a" TO "b";', "RENAME"],
    ["DROP SCHEMA cms CASCADE;", "DROP SCHEMA"],
  ])("flags %s", (sql, label) => {
    expect(findDestructive(sql)).toContain(label);
  });

  it.each([
    "BEGIN; TRUNCATE leads; COMMIT;",
    'CREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW EXECUTE FUNCTION f(); TRUNCATE "Lead";',
  ])("flags a TRUNCATE statement next to other SQL: %s", (sql) => {
    expect(findDestructive(sql)).toContain("TRUNCATE");
  });

  it("does not flag TRUNCATE as a trigger event (append-only guards, F1-001)", () => {
    const sql = `CREATE TRIGGER a BEFORE TRUNCATE ON "AuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION f();
CREATE TRIGGER b AFTER UPDATE OR TRUNCATE ON "AuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION f();
CREATE TRIGGER c BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION f();`;
    expect(findDestructive(sql)).toEqual([]);
  });

  it("ignores additive SQL and statements inside comments", () => {
    const sql = `-- DROP TABLE old;\n/* TRUNCATE x; */\nCREATE TABLE "Lead" ("id" TEXT PRIMARY KEY);\nALTER TABLE "Lead" ALTER COLUMN "id" DROP NOT NULL;`;
    expect(findDestructive(sql)).toEqual([]);
  });
});

describe("checkMigrationsDir", () => {
  it("passes for an empty migrations folder", () => {
    expect(checkMigrationsDir(tempDir()).errors).toEqual([]);
  });

  it("passes for additive migrations with a postgresql lock file", () => {
    const d = tempDir();
    writeFileSync(path.join(d, "migration_lock.toml"), LOCK);
    migration(d, "20261110120000_init", 'CREATE TABLE "Lead" ("id" TEXT PRIMARY KEY);');
    expect(checkMigrationsDir(d).errors).toEqual([]);
  });

  it("fails on bad names, missing or empty SQL and a missing lock file", () => {
    const d = tempDir();
    migration(d, "init", "CREATE TABLE a (id int);");
    migration(d, "20261110120000_empty", "-- nothing\n");
    mkdirSync(path.join(d, "20261110120001_nosql"));
    const { errors } = checkMigrationsDir(d);
    expect(errors.join("\n")).toMatch(/init: folder name/);
    expect(errors.join("\n")).toMatch(/_empty: migration.sql is empty/);
    expect(errors.join("\n")).toMatch(/_nosql: migration.sql is missing/);
    expect(errors.join("\n")).toMatch(/migration_lock.toml is missing/);
  });

  it("fails on a destructive migration without approval", () => {
    const d = tempDir();
    writeFileSync(path.join(d, "migration_lock.toml"), LOCK);
    migration(d, "20261110120000_drop", 'DROP TABLE "Lead";');
    expect(checkMigrationsDir(d).errors).toEqual([
      "20261110120000_drop: destructive statement(s) DROP TABLE without DESTRUCTIVE_APPROVED.md (ADR-010)",
    ]);
  });

  it("requires reason, backup and reviewer in the approval", () => {
    const d = tempDir();
    writeFileSync(path.join(d, "migration_lock.toml"), LOCK);
    migration(d, "20261110120000_drop", 'DROP TABLE "Lead";', {
      "DESTRUCTIVE_APPROVED.md": "Reason: x\n",
    });
    expect(checkMigrationsDir(d).errors[0]).toMatch(/lacks Backup:, Reviewed-by:/);
    expect(approvalProblems("Reason: a\nBackup: dump 2026-11-10\nReviewed-by: owner\n")).toEqual(
      [],
    );
  });
});

// The Node toolbox image has no git, so locally these are skipped, not passed. On GitHub Actions
// git is required: there a missing git fails the suite instead of skipping it silently (F0-006).
// GITHUB_ACTIONS, not CI, because the local toolbox also sets CI=1.
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const requireGit = process.env.GITHUB_ACTIONS === "true";

describe.skipIf(!hasGit && !requireGit)("checkImmutable", () => {
  beforeAll(() => {
    if (!hasGit) throw new Error("git is required on GitHub Actions; checkImmutable must not skip");
  });

  function repoWithMigration() {
    const root = tempDir();
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    const dir = path.join(root, "migrations");
    mkdirSync(dir);
    migration(dir, "20261110120000_init", "CREATE TABLE a (id int);");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    return { root, dir, git };
  }

  it("allows new migrations", () => {
    const { root, dir } = repoWithMigration();
    migration(dir, "20261110130000_next", "CREATE TABLE b (id int);");
    expect(checkImmutable(dir, "main", root)).toEqual([]);
  });

  it("rejects edits and deletions of committed migrations", () => {
    const { root, dir } = repoWithMigration();
    writeFileSync(
      path.join(dir, "20261110120000_init", "migration.sql"),
      "CREATE TABLE a (id bigint);",
    );
    expect(checkImmutable(dir, "main", root)).toEqual([
      "migrations/20261110120000_init/migration.sql: modified after it was committed on main",
    ]);
    rmSync(path.join(dir, "20261110120000_init"), { recursive: true });
    expect(checkImmutable(dir, "main", root)[0]).toMatch(/deleted after it was committed/);
  });
});
