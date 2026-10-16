import { NightscoutCredential } from "../../schemas/glucose";

export { NightscoutCredential };

/**
 * What `source-connect` stores in Key Vault under `glucose-<spaceId>` for a Nightscout space and
 * what the poller reads back by `secretRef` (plan §4). The URL is in it: the database keeps
 * nothing that locates a person's site.
 */
export function serializeNightscoutCredential(credential: NightscoutCredential): string {
  return JSON.stringify(NightscoutCredential.parse(credential));
}

/** Throws on anything that is not a credential, so a wrong secret fails the cycle loudly. */
export function parseNightscoutCredential(value: string): NightscoutCredential {
  return NightscoutCredential.parse(JSON.parse(value));
}
