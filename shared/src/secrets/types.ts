/**
 * Where credentials live (spec §3): Key Vault in production, memory in tests and the seed.
 *
 * A secret has a name and versions. `set` writes a new version and answers the reference that
 * names exactly it, `<name>/<version>`, so a reader holding that reference reads the value as it
 * was written and never a later one (#78). `get` takes such a reference, or a plain name for the
 * latest version: that is what a space stored before references carried a version.
 */
export interface Secrets {
  /** The value the reference names, or undefined when there is no such secret or version. */
  get(ref: string): Promise<string | undefined>;
  /** Writes a new version under `name` and answers the reference to exactly that version. */
  set(name: string, value: string): Promise<string>;
}

/** The Key Vault name for a space's glucose-source credential; versions sit under it. */
export function glucoseSecretName(spaceId: string): string {
  return `glucose-${spaceId}`;
}

/** A parsed reference: the secret's name and, when it names a version, that version. */
export interface SecretRef {
  name: string;
  version?: string;
}

const NAME = /^[a-z0-9-]+$/;
const VERSION = /^[a-z0-9]+$/;

/** Throws unless `name` is a plain secret name: lower-case letters, digits and dashes. */
export function assertSecretName(name: string): void {
  // Neither the name nor a value ever reaches an error message.
  if (!NAME.test(name)) throw new Error("secret name is invalid");
}

/**
 * Splits `<name>` or `<name>/<version>`. The name is `[a-z0-9-]`, the version `[a-z0-9]` (Key
 * Vault's are 32 hex characters); anything else throws, so a reference never reaches a file path
 * or a vault URL unchecked.
 */
export function parseSecretRef(ref: string): SecretRef {
  const slash = ref.indexOf("/");
  if (slash === -1) {
    assertSecretName(ref);
    return { name: ref };
  }
  const name = ref.slice(0, slash);
  const version = ref.slice(slash + 1);
  assertSecretName(name);
  if (!VERSION.test(version)) throw new Error("secret version is invalid");
  return { name, version };
}

/** The reference to one version of a secret, as `set` answers it. */
export function formatSecretRef(name: string, version: string): string {
  assertSecretName(name);
  if (!VERSION.test(version)) throw new Error("secret version is invalid");
  return `${name}/${version}`;
}
