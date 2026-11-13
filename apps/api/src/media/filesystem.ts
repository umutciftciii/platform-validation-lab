/**
 * Filesystem adapter: one directory (a Docker named volume in DEV). Writes go to a temporary file
 * next to the target and are renamed into place, so a reader never sees half a file. Files and
 * directories are private to the API's user (0600 / 0700). Keys are validated before any path is
 * built (no traversal).
 */
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertKey,
  MediaStorageError,
  STRAY_PATTERN,
  type MediaStorage,
  type StoredObject,
} from "./storage.js";

export class FilesystemStorage implements MediaStorage {
  readonly kind = "filesystem" as const;
  private readonly root: string;

  constructor(root: string) {
    if (!path.isAbsolute(root))
      throw new MediaStorageError("DP_MEDIA_DIR must be an absolute path");
    this.root = path.resolve(root);
  }

  private pathOf(key: string): string {
    const p = path.resolve(this.root, assertKey(key));
    if (!p.startsWith(this.root + path.sep)) throw new MediaStorageError("invalid media key");
    return p;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    void _contentType; // the filesystem keeps no type; the database row has it
    const target = this.pathOf(key);
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(tmp, data, { mode: 0o600, flag: "wx" });
      await rename(tmp, target);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw new MediaStorageError(`write failed (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new MediaStorageError(`read failed (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathOf(key), { force: true });
    } catch (e) {
      throw new MediaStorageError(
        `delete failed (${(e as NodeJS.ErrnoException).code ?? "error"})`,
      );
    }
  }

  /** Files under products/ (two levels: products/<id>/<file>); symbolic links are skipped. */
  async *list(): AsyncIterable<StoredObject> {
    const top = path.join(this.root, "products");
    let dirs: string[];
    try {
      dirs = await readdir(top);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new MediaStorageError(`list failed (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    for (const dir of dirs.sort()) {
      const full = path.join(top, dir);
      const st = await lstat(full);
      if (!st.isDirectory()) {
        yield { key: `products/${dir}`, size: st.size, lastModified: st.mtime };
        continue;
      }
      for (const file of (await readdir(full)).sort()) {
        const f = await lstat(path.join(full, file));
        if (!f.isFile()) continue;
        yield { key: `products/${dir}/${file}`, size: f.size, lastModified: f.mtime };
      }
    }
  }

  async deleteStray(name: string): Promise<void> {
    if (!STRAY_PATTERN.test(name)) throw new MediaStorageError("invalid stray name");
    const p = path.resolve(this.root, name);
    if (!p.startsWith(this.root + path.sep)) throw new MediaStorageError("invalid stray name");
    await rm(p, { force: true });
  }

  /** Removes empty image directories left after deletions (best effort). */
  async pruneEmptyDirs(): Promise<number> {
    const top = path.join(this.root, "products");
    let removed = 0;
    for (const dir of await readdir(top).catch(() => [] as string[])) {
      const full = path.join(top, dir);
      if (!/^[0-9a-f]{32}$/.test(dir)) continue;
      if ((await readdir(full).catch(() => ["x"])).length === 0) {
        await rmdir(full).catch(() => undefined);
        removed++;
      }
    }
    return removed;
  }
}
