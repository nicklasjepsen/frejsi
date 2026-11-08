import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  assertSecretName,
  formatSecretRef,
  parseSecretRef,
  type SecretListing,
  type Secrets,
} from "./types";

/**
 * Files under a directory (Docker Compose, plan v0.5.0 §9): names `[a-z0-9-]`, mode 600, a
 * missing file is `undefined`, every write goes to a temporary file and is renamed over its target
 * so a reader never sees half a value. `set` writes the version as `<name>.<version>` and then the
 * same value as `<name>`, the latest, which a plain reference reads; a reference with a version
 * reads only its own file. A `<name>` written before versions existed is simply the latest.
 */
export class FileSecrets implements Secrets {
  constructor(private readonly directory: string) {}

  async get(ref: string): Promise<string | undefined> {
    const { name, version } = parseSecretRef(ref);
    try {
      return await readFile(this.fileFor(name, version), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async set(name: string, value: string): Promise<string> {
    assertSecretName(name);
    const version = randomBytes(8).toString("hex");
    const ref = formatSecretRef(name, version);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.write(this.fileFor(name, version), value);
    await this.write(this.fileFor(name), value);
    return ref;
  }

  /** Removes `<name>` and every `<name>.<version>`; a missing directory or file is fine. */
  async delete(name: string): Promise<void> {
    assertSecretName(name);
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const prefix = `${name}.`;
    // A version is `[a-z0-9]`, so `<name>.<version>` never matches a longer name's files.
    const own = files.filter(
      (file) =>
        file === name || (file.startsWith(prefix) && /^[a-z0-9]+$/.test(file.slice(prefix.length))),
    );
    await Promise.all(own.map((file) => rm(path.join(this.directory, file), { force: true })));
  }

  /**
   * Every name under `prefix`, from its `<name>` file or, when a write stopped before that file,
   * its version files; `updatedOn` is the newest file's time. Temporary files are skipped.
   */
  async list(prefix: string): Promise<SecretListing[]> {
    assertSecretName(prefix);
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const newest = new Map<string, number>();
    for (const file of files) {
      const dot = file.indexOf(".");
      const name = dot === -1 ? file : file.slice(0, dot);
      if (!name.startsWith(prefix) || !/^[a-z0-9-]+$/.test(name)) continue;
      if (dot !== -1 && !/^[a-z0-9]+$/.test(file.slice(dot + 1))) continue;
      let modified: number;
      try {
        modified = (await stat(path.join(this.directory, file))).mtimeMs;
      } catch (error) {
        // Deleted between the listing and here.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      newest.set(name, Math.max(newest.get(name) ?? 0, modified));
    }
    return [...newest].map(([name, modified]) => ({ name, updatedOn: new Date(modified) }));
  }

  /** `<name>` is the latest; a version has its own file, which no plain name can be called. */
  private fileFor(name: string, version?: string): string {
    return path.join(this.directory, version === undefined ? name : `${name}.${version}`);
  }

  private async write(target: string, value: string): Promise<void> {
    // The leading dot cannot clash with a secret name or a version file.
    const temporary = path.join(
      this.directory,
      `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
    );
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, target);
  }
}
