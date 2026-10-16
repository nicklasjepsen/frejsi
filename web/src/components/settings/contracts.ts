// The request bodies of the Settings routes. The response shapes (`SpaceSettings`, `UserSettings`,
// `ConnectSourceRequest`) are the shared contracts; these are the partial writes the screens send.
import {
  Accent,
  ConnectSourceRequest,
  DexcomShareRegion,
  GlucoseSourceType,
  UpdateSpaceSettingsRequest,
  Locale,
  SourceStatus,
  Theme,
} from "@frejsi/shared";
import { z } from "zod";

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((v) => v !== undefined);

/** Per space, owners only. Targets are always in mmol (plan §3); the client converts for mg/dL. */
export const SpaceSettingsPatch = UpdateSpaceSettingsRequest;
export type SpaceSettingsPatch = z.infer<typeof SpaceSettingsPatch>;

/** Per user: one's own, or another member's when an owner sets them. */
export const UserSettingsPatch = z
  .strictObject({
    locale: Locale.optional(),
    simpleMode: z.boolean().optional(),
    accent: Accent.optional(),
    theme: Theme.optional(),
  })
  .refine(atLeastOne, { message: "nothing to change" });
export type UserSettingsPatch = z.infer<typeof UserSettingsPatch>;

/**
 * What the connect forms post; the route adds the `spaceId` from the path, so a body with one is
 * refused. The Nightscout address is only a bounded string here: the route checks it against the
 * shared `ConnectSourceRequest` and answers `source-url-invalid`, so a bad address is told apart
 * from a malformed body.
 */
export const ConnectSourceBody = z.discriminatedUnion("type", [
  ConnectSourceRequest.options[0].omit({ spaceId: true }).strict(),
  z.strictObject({
    type: z.literal("nightscout"),
    url: z.string().max(2048),
    token: z.string().min(1).max(200).optional(),
    apiSecret: z.string().min(1).max(200).optional(),
  }),
  z.strictObject({ type: z.literal("manual") }),
]);
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
