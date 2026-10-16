import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { Secrets } from "./types";

const NAME = /^[a-z0-9-]+$/;

function assertName(name: string): void {
  // Neither the name nor the value ever reaches an error message.
  if (!NAME.test(name)) throw new Error("secret name is invalid");
}

/**
 * One file per secret under a directory (Docker Compose, plan v0.5.0 §9): names `[a-z0-9-]`, mode
 * 600, a missing file is `undefined`, `set` writes a temporary file and renames it over the secret
 * so a reader never sees half a value.
 */
export class FileSecrets implements Secrets {
  constructor(private readonly directory: string) {}

  async get(name: string): Promise<string | undefined> {
    assertName(name);
    try {
      return await readFile(path.join(this.directory, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async set(name: string, value: string): Promise<void> {
    assertName(name);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // The leading dot cannot clash with a secret name.
    const temporary = path.join(this.directory, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, path.join(this.directory, name));
  }
}
