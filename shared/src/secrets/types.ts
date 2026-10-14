/** Where credentials live (spec §3): Key Vault in production, memory in tests and the seed. */
export interface Secrets {
  /** The secret's value, or undefined when there is none under that name. */
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
}

/** The Key Vault name for a space's glucose-source credential. */
export function glucoseSecretName(spaceId: string): string {
  return `glucose-${spaceId}`;
}
