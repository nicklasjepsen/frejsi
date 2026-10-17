import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileSecrets } from "./file";
import { parseSecretRef, type Secrets } from "./types";

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

  it("answers a versioned reference that keeps reading its own value after a later set (#78)", async () => {
    const secrets = new FileSecrets(dir);
    const first = await secrets.set("glucose-s1", "first");
    const second = await secrets.set("glucose-s1", "second");
    expect(parseSecretRef(first).name).toBe("glucose-s1");
    expect(parseSecretRef(first).version).toMatch(/^[0-9a-f]{16}$/);
    expect(first).not.toBe(second);
    await expect(secrets.get(first)).resolves.toBe("first");
    await expect(secrets.get(second)).resolves.toBe("second");
    await expect(secrets.get("glucose-s1")).resolves.toBe("second");
    await expect(secrets.get("glucose-s1/0123456789abcdef")).resolves.toBeUndefined();
  });

  it("writes the version and the latest with mode 600 and leaves no temporary file behind", async () => {
    const ref = await new FileSecrets(dir).set("glucose-s1", "x");
    const { version } = parseSecretRef(ref);
    expect(readdirSync(dir).sort()).toEqual(["glucose-s1", `glucose-s1.${version}`]);
    for (const file of readdirSync(dir)) {
      expect(statSync(path.join(dir, file)).mode & 0o777, file).toBe(0o600);
    }
  });

  it("reads a file written before references had versions as the latest", async () => {
    writeFileSync(path.join(dir, "glucose-s1"), "from-before", { mode: 0o600 });
    await expect(new FileSecrets(dir).get("glucose-s1")).resolves.toBe("from-before");
  });

  it("creates the directory when it does not exist yet", async () => {
    const nested = path.join(dir, "a", "b");
    await new FileSecrets(nested).set("x", "1");
    await expect(new FileSecrets(nested).get("x")).resolves.toBe("1");
  });

  it("restricts names to lower-case letters, digits and dashes, and versions to letters and digits", async () => {
    const secrets = new FileSecrets(dir);
    for (const name of ["", "../x", "A", "a.b", "a b", "a_b", "x\0"]) {
      await expect(secrets.get(name), name).rejects.toThrow(/secret name/);
      await expect(secrets.set(name, "v"), name).rejects.toThrow(/secret name/);
    }
    // A reference may carry a version; a name to write under may not.
    await expect(secrets.set("a/b", "v")).rejects.toThrow(/secret name/);
    await expect(secrets.get("a/../b")).rejects.toThrow(/secret version/);
    await expect(secrets.get("a/b.tmp")).rejects.toThrow(/secret version/);
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
