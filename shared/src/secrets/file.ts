import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { assertSecretName, formatSecretRef, parseSecretRef, type Secrets } from "./types";

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
