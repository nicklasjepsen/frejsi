import { z } from "zod";

/**
 * What `source-connect` stores in Key Vault as a version of `glucose-<spaceId>` and what the poller
 * reads back by `secretRef`, which names that version (spec §3, #78). The database never sees it.
 */
export const DexcomShareCredential = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type DexcomShareCredential = z.infer<typeof DexcomShareCredential>;

export function serializeCredential(credential: DexcomShareCredential): string {
  return JSON.stringify(DexcomShareCredential.parse(credential));
}

/** Throws on anything that is not a credential, so a wrong secret fails the cycle loudly. */
export function parseCredential(value: string): DexcomShareCredential {
  return DexcomShareCredential.parse(JSON.parse(value));
}
