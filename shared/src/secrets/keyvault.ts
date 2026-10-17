import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

import { FileSecrets } from "./file";
import { assertSecretName, formatSecretRef, parseSecretRef, type Secrets } from "./types";

/** The slice of `SecretClient` the adapter uses; tests pass a fake. */
export interface SecretClientLike {
  getSecret(
    name: string,
    options?: { version?: string | undefined },
  ): Promise<{ value?: string | undefined }>;
  setSecret(name: string, value: string): Promise<{ properties: { version?: string | undefined } }>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

/**
 * Key Vault through the Function App's managed identity (plan §7). Every `setSecret` makes a new
 * version and Key Vault answers its id; `set` hands that back as `<name>/<version>`, and `get`
 * asks for that version by name, or for the latest when the reference has none. Key Vault Secrets
 * User reads any version, so the poller needs no further right.
 */
export class KeyVaultSecrets implements Secrets {
  constructor(private readonly client: SecretClientLike) {}

  async get(ref: string): Promise<string | undefined> {
    const { name, version } = parseSecretRef(ref);
    try {
      const secret = await this.client.getSecret(name, version === undefined ? {} : { version });
      return secret.value;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async set(name: string, value: string): Promise<string> {
    assertSecretName(name);
    const { properties } = await this.client.setSecret(name, value);
    // A version is what makes the reference immutable; without one the write is not usable.
    if (!properties.version) throw new Error("Key Vault answered a secret without a version");
    return formatSecretRef(name, properties.version);
  }
}

/** `process.env` or a plain object with the same keys. */
export type SecretsEnv = Record<string, string | undefined>;

/**
 * Key Vault when `KEY_VAULT_URL` is set (Azure, and it wins when both are set), otherwise one file
 * per secret under `SECRETS_DIR` (Docker Compose). The choice lives here and nowhere in web/ or
 * poller/ (shared/src/secrets/boundaries.test.ts).
 */
export function createSecretsFromEnv(
  env: SecretsEnv = process.env,
  factory: (url: string) => SecretClientLike = (url) =>
    new SecretClient(url, new DefaultAzureCredential()),
): Secrets {
  const url = env.KEY_VAULT_URL;
  if (url) return new KeyVaultSecrets(factory(url));
  const directory = env.SECRETS_DIR;
  if (directory) return new FileSecrets(directory);
  throw new Error(
    "KEY_VAULT_URL is not set; secrets need a Key Vault (or SECRETS_DIR for Docker Compose) outside tests",
  );
}
