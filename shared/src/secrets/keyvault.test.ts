import { describe, expect, it } from "vitest";

import { FileSecrets } from "./file";
import { createSecretsFromEnv, KeyVaultSecrets, type SecretClientLike } from "./keyvault";
import type { Secrets } from "./types";

/**
 * A vault as a map of `name` to its versions, newest last, and a record of what was asked for. A
 * version id is 32 hex characters, as Key Vault's are.
 */
function fakeClient(store: Record<string, string[]>) {
  const asked: { name: string; version: string | undefined }[] = [];
  const client: SecretClientLike = {
    getSecret: (name, options) => {
      asked.push({ name, version: options?.version });
      const versions = store[name] ?? [];
      const value =
        options?.version === undefined ? versions.at(-1) : versions[Number(options.version)];
      if (value === undefined) {
        return Promise.reject(Object.assign(new Error("not found"), { statusCode: 404 }));
      }
      return Promise.resolve({ value });
    },
    setSecret: (name, value) => {
      const versions = (store[name] ??= []);
      versions.push(value);
      return Promise.resolve({ properties: { version: String(versions.length - 1) } });
    },
  };
  return { client, asked };
}

describe("KeyVaultSecrets", () => {
  it("implements Secrets over a SecretClient and maps 404 to undefined", async () => {
    const store: Record<string, string[]> = { "glucose-s1": ["x"] };
    const secrets: Secrets = new KeyVaultSecrets(fakeClient(store).client);
    await expect(secrets.get("glucose-s1")).resolves.toBe("x");
    await expect(secrets.get("missing")).resolves.toBeUndefined();
    await expect(secrets.get("glucose-s1/9")).resolves.toBeUndefined();
    await expect(secrets.set("glucose-s2", "y")).resolves.toBe("glucose-s2/0");
    expect(store["glucose-s2"]).toEqual(["y"]);
  });

  it("answers the version Key Vault wrote and reads exactly that version by it (#78)", async () => {
    const store: Record<string, string[]> = {};
    const { client, asked } = fakeClient(store);
    const secrets = new KeyVaultSecrets(client);
    const first = await secrets.set("glucose-s1", "first");
    const second = await secrets.set("glucose-s1", "second");
    expect([first, second]).toEqual(["glucose-s1/0", "glucose-s1/1"]);
    await expect(secrets.get(first)).resolves.toBe("first");
    await expect(secrets.get(second)).resolves.toBe("second");
    // A reference stored before versions existed: the plain name, which reads the latest.
    await expect(secrets.get("glucose-s1")).resolves.toBe("second");
    expect(asked).toEqual([
      { name: "glucose-s1", version: "0" },
      { name: "glucose-s1", version: "1" },
      { name: "glucose-s1", version: undefined },
    ]);
  });

  it("refuses a write whose answer carries no version, and a malformed reference", async () => {
    const client: SecretClientLike = {
      getSecret: () => Promise.reject(new Error("unused")),
      setSecret: () => Promise.resolve({ properties: {} }),
    };
    const secrets = new KeyVaultSecrets(client);
    await expect(secrets.set("glucose-s1", "v")).rejects.toThrow(/without a version/);
    await expect(secrets.get("glucose-s1/../other")).rejects.toThrow(/^secret version is invalid$/);
    await expect(secrets.set("Glucose/s1", "v")).rejects.toThrow(/^secret name is invalid$/);
  });

  it("rethrows anything that is not a 404", async () => {
    const client: SecretClientLike = {
      getSecret: () => Promise.reject(Object.assign(new Error("forbidden"), { statusCode: 403 })),
      setSecret: () => Promise.reject(new Error("unused")),
    };
    await expect(new KeyVaultSecrets(client).get("x")).rejects.toThrow("forbidden");
  });
});

describe("createSecretsFromEnv", () => {
  it("builds a Key Vault client from KEY_VAULT_URL and refuses to run without one", () => {
    const seen: string[] = [];
    const secrets = createSecretsFromEnv({ KEY_VAULT_URL: "https://kv.example.invalid" }, (url) => {
      seen.push(url);
      return fakeClient({}).client;
    });
    expect(secrets).toBeInstanceOf(KeyVaultSecrets);
    expect(seen).toEqual(["https://kv.example.invalid"]);
    expect(() => createSecretsFromEnv({})).toThrow(/KEY_VAULT_URL/);
  });

  it("falls back to files under SECRETS_DIR and prefers Key Vault when both are set", () => {
    expect(createSecretsFromEnv({ SECRETS_DIR: "/run/fictional-secrets" })).toBeInstanceOf(
      FileSecrets,
    );
    expect(
      createSecretsFromEnv(
        { KEY_VAULT_URL: "https://kv.example.invalid", SECRETS_DIR: "/run/fictional-secrets" },
        () => fakeClient({}).client,
      ),
    ).toBeInstanceOf(KeyVaultSecrets);
    expect(() => createSecretsFromEnv({ SECRETS_DIR: "" })).toThrow(/KEY_VAULT_URL/);
  });
});
