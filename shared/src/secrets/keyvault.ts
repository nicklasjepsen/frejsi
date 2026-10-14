import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

import type { Secrets } from "./types";

/** The slice of `SecretClient` the adapter uses; tests pass a fake. */
export interface SecretClientLike {
  getSecret(name: string): Promise<{ value?: string | undefined }>;
  setSecret(name: string, value: string): Promise<unknown>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

/** Key Vault through the Function App's managed identity (plan §7). */
export class KeyVaultSecrets implements Secrets {
  constructor(private readonly client: SecretClientLike) {}

  async get(name: string): Promise<string | undefined> {
    try {
      const secret = await this.client.getSecret(name);
      return secret.value;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async set(name: string, value: string): Promise<void> {
    await this.client.setSecret(name, value);
  }
}

/** `process.env` or a plain object with the same keys. */
export type SecretsEnv = Record<string, string | undefined>;

export function createSecretsFromEnv(
  env: SecretsEnv = process.env,
  factory: (url: string) => SecretClientLike = (url) =>
    new SecretClient(url, new DefaultAzureCredential()),
): Secrets {
  const url = env.KEY_VAULT_URL;
  if (!url) {
    throw new Error("KEY_VAULT_URL is not set; secrets need a Key Vault outside tests");
  }
  return new KeyVaultSecrets(factory(url));
}
