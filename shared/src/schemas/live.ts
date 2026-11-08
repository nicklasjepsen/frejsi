import { z } from "zod";

import { NightscoutUrl } from "./glucose";

/**
 * The push relay's register API (plan 2026-11-08-ios-follower-app §4): the iPhone app ⇄ the
 * poller's `live-register` functions. The app is built against exactly these shapes.
 */

/** The literal the app sends to follow the relay's made-up demo curve (App Review, Simulator). */
export const LIVE_DEMO_URL = "demo";

/** An APNs token as hex; normalised to lower case, which is what the sender accepts. */
export const ApnsTokenHex = z
  .string()
  .regex(/^[0-9a-fA-F]{32,400}$/)
  .transform((value) => value.toLowerCase());

export const LiveApnsEnvironment = z.enum(["sandbox", "production"]);
export type LiveApnsEnvironment = z.infer<typeof LiveApnsEnvironment>;

export const LiveUnit = z.enum(["mmolL", "mgdL"]);
export type LiveUnit = z.infer<typeof LiveUnit>;

export const LiveLanguage = z.enum(["da", "en"]);
export type LiveLanguage = z.infer<typeof LiveLanguage>;

const mgdl = z.number().int().min(20).max(600);

/** The four colour thresholds in mg/dL, in order; low and high also drive the relay's alerts. */
export const LiveThresholds = z
  .object({
    urgentLowMgdl: mgdl,
    lowMgdl: mgdl,
    highMgdl: mgdl,
    urgentHighMgdl: mgdl,
  })
  .refine(
    (t) => t.urgentLowMgdl <= t.lowMgdl && t.lowMgdl < t.highMgdl && t.highMgdl <= t.urgentHighMgdl,
    { message: "Thresholds are in order: urgent low ≤ low < high ≤ urgent high." },
  );
export type LiveThresholds = z.infer<typeof LiveThresholds>;

/** A subscription id as the relay makes it (a UUID); also part of the Key Vault name `live-<id>`. */
export const LiveSubscriptionId = z.string().regex(/^[a-z0-9-]{8,64}$/);

/**
 * `POST /api/live/register`. Without `subscriptionId` it creates a subscription; with it (and the
 * `x-device-secret` header) it updates one. A token field that is absent keeps what the relay has;
 * `null` clears it. `nightscoutToken` may be left out on an update to keep the stored one.
 */
export const LiveRegisterRequest = z.object({
  subscriptionId: LiveSubscriptionId.optional(),
  nightscoutUrl: z.union([z.literal(LIVE_DEMO_URL), NightscoutUrl]),
  nightscoutToken: z.string().min(1).max(200).optional(),
  pushToStartToken: ApnsTokenHex.nullable().optional(),
  activityPushToken: ApnsTokenHex.nullable().optional(),
  activityStartedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  deviceToken: ApnsTokenHex.nullable().optional(),
  apnsEnvironment: LiveApnsEnvironment,
  unit: LiveUnit,
  thresholds: LiveThresholds,
  alertsOn: z.boolean(),
  language: LiveLanguage,
});
export type LiveRegisterRequest = z.infer<typeof LiveRegisterRequest>;

/** 200 on create: the device secret is answered this once and kept by the relay as a hash only. */
export const LiveRegisterCreated = z.strictObject({
  subscriptionId: LiveSubscriptionId,
  deviceSecret: z.string().min(32),
});
export type LiveRegisterCreated = z.infer<typeof LiveRegisterCreated>;

/** 200 on update. */
export const LiveRegisterUpdated = z.strictObject({ subscriptionId: LiveSubscriptionId });
export type LiveRegisterUpdated = z.infer<typeof LiveRegisterUpdated>;

export const LiveRegisterErrorCode = z.enum([
  "validation",
  "not-https",
  "bad-device-secret",
  "nightscout-refused",
  "nightscout-unreachable",
  "rate-limited",
]);
export type LiveRegisterErrorCode = z.infer<typeof LiveRegisterErrorCode>;

/** 400, 401, 422 or 429. */
export const LiveRegisterError = z.strictObject({ error: LiveRegisterErrorCode });
export type LiveRegisterError = z.infer<typeof LiveRegisterError>;
