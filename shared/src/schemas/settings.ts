import { z } from "zod";

import { GlucoseSourceType, GlucoseUnit, SourceStatus } from "./glucose";

/** English identifiers; the Danish names (Oliven, Blomme, Hav, Skov, Granat) are da.json strings. */
export const Accent = z.enum(["olive", "plum", "sea", "forest", "garnet"]);
export type Accent = z.infer<typeof Accent>;

export const Locale = z.enum(["da", "en"]);
export type Locale = z.infer<typeof Locale>;

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

/** Per user: a grandparent and a child in one space may read different languages. */
export const UserSettings = z.object({
  locale: Locale,
  simpleMode: z.boolean(),
  accent: Accent,
});
export type UserSettings = z.infer<typeof UserSettings>;
