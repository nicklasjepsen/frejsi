import type { GlucoseSourceType } from "@frejsi/shared/schemas/glucose";

/**
 * The source cards that connect today. Nightscout and Manuelt are drawn as "coming later" cards
 * until the Settings work of v0.5.0 replaces them, so the shared enum must not add cards of its own.
 */
export const SETTINGS_SOURCE_TYPES: readonly GlucoseSourceType[] = ["dexcom-share"];
