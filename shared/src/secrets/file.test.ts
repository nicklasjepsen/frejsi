import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSecrets } from "./file";
import type { Secrets } from "./types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "frejsi-secrets-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FileSecrets", () => {
  it("satisfies Secrets: set, get, overwrite, and undefined for a missing name", async () => {
    const secrets: Secrets = new FileSecrets(dir);
    await expect(secrets.get("glucose-s1")).resolves.toBeUndefined();
    await secrets.set("glucose-s1", "fictional-value");
    await expect(secrets.get("glucose-s1")).resolves.toBe("fictional-value");
    await secrets.set("glucose-s1", "second");
    await expect(secrets.get("glucose-s1")).resolves.toBe("second");
  });

  it("writes one file per secret with mode 600 and leaves no temporary file behind", async () => {
    await new FileSecrets(dir).set("glucose-s1", "x");
    expect(readdirSync(dir)).toEqual(["glucose-s1"]);
    expect(statSync(path.join(dir, "glucose-s1")).mode & 0o777).toBe(0o600);
  });

  it("creates the directory when it does not exist yet", async () => {
    const nested = path.join(dir, "a", "b");
    await new FileSecrets(nested).set("x", "1");
    await expect(new FileSecrets(nested).get("x")).resolves.toBe("1");
  });

  it("restricts names to lower-case letters, digits and dashes", async () => {
    const secrets = new FileSecrets(dir);
    for (const name of ["", "../x", "a/b", "A", "a.b", "a b", "a_b", "x\0"]) {
      await expect(secrets.get(name), name).rejects.toThrow(/secret name/);
      await expect(secrets.set(name, "v"), name).rejects.toThrow(/secret name/);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("never puts the name or the value in an error", async () => {
    const secrets = new FileSecrets(dir);
    await expect(secrets.set("../fictional-secret-name", "fictional-secret-value")).rejects.toThrow(
      /^secret name is invalid$/,
    );
  });

  it("rethrows anything but a missing file", async () => {
    const file = path.join(dir, "file");
    writeFileSync(file, "");
    // A directory where the secrets directory should be: reading under it is ENOTDIR, not "missing".
    await expect(new FileSecrets(file).get("x")).rejects.toThrow();
  });
});
