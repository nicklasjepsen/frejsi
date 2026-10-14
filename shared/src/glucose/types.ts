import type { ProbeResult, Reading } from "../schemas/glucose";

/**
 * The only thing the rest of the app knows about a glucose source (spec §3). Adapters:
 * `dexcom-share` (v0.1.0), `nightscout` and `manual` later, `FakeGlucoseSource` for dev and tests.
 */
export interface GlucoseSource {
  /** Readings newer than `since`, oldest first. Every reading carries its `ts`. */
  fetchSince(since: Date): Promise<Reading[]>;
  /** Checks the credential without storing anything. */
  probe(): Promise<ProbeResult>;
}
