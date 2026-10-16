import { z } from "zod";

import { GlucoseSourceType, GlucoseUnit, SourceStatus } from "./glucose";

/** English identifiers; the Danish names (Oliven, Blomme, Hav, Skov, Granat) are da.json strings. */
export const Accent = z.enum(["olive", "plum", "sea", "forest", "garnet"]);
export type Accent = z.infer<typeof Accent>;

export const Locale = z.enum(["da", "en"]);
export type Locale = z.infer<typeof Locale>;

/**
 * Light or dark: `system` follows the device (`prefers-color-scheme`), the other two force it.
 * A per-user presentation setting like `accent`; the cookie `frejsi_theme` mirrors it so the
 * first paint already has it (web/src/lib/theme/theme.ts).
 */
export const Theme = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof Theme>;

/** The theme a stored or cookie value names; anything else is the column's default, `system`. */
export function themeOrDefault(value: string | null | undefined): Theme {
  const parsed = Theme.safeParse(value);
  return parsed.success ? parsed.data : Theme.enum.system;
}

/**
 * The locale a stored value names; a missing or unknown value falls back to the database column's
 * default, `da`. Code outside `schemas/` uses this instead of
 * writing a language into a fallback (the literals test refuses that).
 */
export function localeOrDefault(value: string | null | undefined): Locale {
  const parsed = Locale.safeParse(value);
  return parsed.success ? parsed.data : Locale.enum.da;
}

/** Per space. Targets are always in mmol; `glucoseUnit` only changes rendering (plan §3). */
export const SpaceSettings = z
  .strictObject({
    aiEnabled: z.boolean(),
    aiProvider: z.enum(["anthropic", "azure-openai", "ollama"]).optional(),
    name: z.string().min(1),
    glucoseUnit: GlucoseUnit,
    targetLow: z.number().min(0).max(40),
    targetHigh: z.number().min(0).max(40),
    timezone: z.string().min(1),
    sourceType: GlucoseSourceType.nullable(),
    sourceStatus: SourceStatus,
    lastReadingAt: z.iso.datetime().nullable(),
  })
  .refine((s) => s.targetLow < s.targetHigh, {
    message: "targetLow must be below targetHigh",
    path: ["targetHigh"],
  });
export type SpaceSettings = z.infer<typeof SpaceSettings>;

/**
 * The answer to connecting a source: the settings, plus `recentReadings` from
 * `ConnectSourceResult` when the function could read the last day (zero is the follower-login
 * case the form warns about).
 */
export const ConnectedSourceSettings = SpaceSettings.safeExtend({
  recentReadings: z.number().int().nonnegative().optional(),
});
export type ConnectedSourceSettings = z.infer<typeof ConnectedSourceSettings>;

/** Per user: a grandparent and a child in one space may read different languages. */
export const UserSettings = z.object({
  locale: Locale,
  simpleMode: z.boolean(),
  accent: Accent,
  theme: Theme,
});
export type UserSettings = z.infer<typeof UserSettings>;
