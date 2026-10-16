import { describe, expect, it } from "vitest";

import { FileSecrets } from "./file";
import { createSecretsFromEnv, KeyVaultSecrets, type SecretClientLike } from "./keyvault";
import type { Secrets } from "./types";

function fakeClient(store: Record<string, string>) {
  const client: SecretClientLike = {
    getSecret: (name) => {
      if (!(name in store)) {
        return Promise.reject(Object.assign(new Error("not found"), { statusCode: 404 }));
      }
      return Promise.resolve({ value: store[name] });
    },
    setSecret: (name, value) => {
      store[name] = value;
      return Promise.resolve({ value });
    },
  };
  return client;
}

describe("KeyVaultSecrets", () => {
  it("implements Secrets over a SecretClient and maps 404 to undefined", async () => {
    const store: Record<string, string> = { "glucose-s1": "x" };
    const secrets: Secrets = new KeyVaultSecrets(fakeClient(store));
    await expect(secrets.get("glucose-s1")).resolves.toBe("x");
    await expect(secrets.get("missing")).resolves.toBeUndefined();
    await secrets.set("glucose-s2", "y");
    expect(store["glucose-s2"]).toBe("y");
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
      return fakeClient({});
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
        () => fakeClient({}),
      ),
    ).toBeInstanceOf(KeyVaultSecrets);
    expect(() => createSecretsFromEnv({ SECRETS_DIR: "" })).toThrow(/KEY_VAULT_URL/);
  });
});
