// The request bodies of the Settings routes. The response shapes (`SpaceSettings`, `UserSettings`,
// `ConnectSourceRequest`) are the shared contracts; these are the partial writes the screens send.
import {
  Accent,
  ConnectSourceRequest,
  DexcomShareRegion,
  GlucoseSourceType,
  GlucoseUnit,
  Locale,
  SourceStatus,
} from "@frejsi/shared";
import { z } from "zod";

const oneDecimal = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
const target = z.number().min(0).max(40).refine(oneDecimal, { message: "one decimal" });

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((v) => v !== undefined);

/** Per space, owners only. Targets are always in mmol (plan §3); the client converts for mg/dL. */
export const SpaceSettingsPatch = z
  .strictObject({
    glucoseUnit: GlucoseUnit.optional(),
    targetLow: target.optional(),
    targetHigh: target.optional(),
  })
  .refine(atLeastOne, { message: "nothing to change" })
  .refine(
    (p) => p.targetLow === undefined || p.targetHigh === undefined || p.targetLow < p.targetHigh,
    { message: "targetLow must be below targetHigh", path: ["targetHigh"] },
  );
export type SpaceSettingsPatch = z.infer<typeof SpaceSettingsPatch>;

/** Per user: one's own, or another member's when an owner sets them. */
export const UserSettingsPatch = z
  .strictObject({
    locale: Locale.optional(),
    simpleMode: z.boolean().optional(),
    accent: Accent.optional(),
  })
  .refine(atLeastOne, { message: "nothing to change" });
export type UserSettingsPatch = z.infer<typeof UserSettingsPatch>;

/**
 * What the connect form posts; the route adds the `spaceId` from the path, so a body with one is
 * refused. Dexcom Share only until the Nightscout form and the `manual` choice reach Settings (v0.5.0).
 */
export const ConnectSourceBody = ConnectSourceRequest.options[0].omit({ spaceId: true }).strict();
export type ConnectSourceBody = z.infer<typeof ConnectSourceBody>;

/**
 * `GET /api/spaces/:id/source`: the configured source as the screens show it (the desktop card
 * names the region), never the `secretRef`. All null but the status before one is configured.
 * `since` is the time of the latest `source.status` event, for the banner's "siden {time}".
 */
export const SourceView = z.object({
  type: GlucoseSourceType.nullable(),
  region: DexcomShareRegion.nullable(),
  status: SourceStatus,
  lastReadingAt: z.iso.datetime().nullable(),
  since: z.iso.datetime().nullable(),
});
export type SourceView = z.infer<typeof SourceView>;

/** The patch without its undefined keys, so it can be a Prisma `data` object as it is. */
export function definedOnly<T extends Record<string, unknown>>(
  patch: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) out[key] = value;
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
