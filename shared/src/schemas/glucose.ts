import { z } from "zod";

/** Dexcom's trend set; adapters map their own vocabulary to it (plan §4). */
export const Trend = z.enum([
  "double-up",
  "single-up",
  "forty-five-up",
  "flat",
  "forty-five-down",
  "single-down",
  "double-down",
  "not-computable",
  "rate-out-of-range",
]);
export type Trend = z.infer<typeof Trend>;

const oneDecimal = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;

/**
 * A glucose reading. There is no schema for a value without `ts`: a value never travels or renders
 * without its time (CLAUDE.md hard rule). `mmol` is the canonical unit, one decimal.
 */
export const Reading = z.object({
  ts: z.iso.datetime(),
  mmol: z.number().min(0).max(40).refine(oneDecimal, { message: "mmol has one decimal" }),
  trend: Trend,
});
export type Reading = z.infer<typeof Reading>;

export const GlucoseUnit = z.enum(["mmol", "mgdl"]);
export type GlucoseUnit = z.infer<typeof GlucoseUnit>;

export const GlucoseSourceType = z.enum(["dexcom-share", "nightscout", "manual"]);
export type GlucoseSourceType = z.infer<typeof GlucoseSourceType>;

/** The types the poller fetches from; `manual` has no adapter and is never polled (plan §4). */
export type PolledSourceType = Exclude<GlucoseSourceType, "manual">;

export const DexcomShareRegion = z.enum(["eu", "us"]);
export type DexcomShareRegion = z.infer<typeof DexcomShareRegion>;

/**
 * Stored as JSON on `Space.glucoseSource`. The credential lives in Key Vault under `secretRef`;
 * for Nightscout that includes the site's URL, so the database holds nothing that locates it.
 */
export const GlucoseSourceConfig = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dexcom-share"),
    region: DexcomShareRegion,
    secretRef: z.string().min(1),
  }),
  z.strictObject({ type: z.literal("nightscout"), secretRef: z.string().min(1) }),
  z.strictObject({ type: z.literal("manual") }),
]);
export type GlucoseSourceConfig = z.infer<typeof GlucoseSourceConfig>;

/**
 * An https URL with no query, fragment or userinfo: a token in the URL would reach every log.
 * Exported for `ConnectPumpRequest` (`schemas/pump.ts`), which connects a pump record on the same
 * Nightscout rules.
 */
export const NightscoutUrl = z
  .url({ protocol: /^https$/, hostname: z.regexes.domain })
  .max(2048)
  .refine(
    (value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.search === "" && url.hash === "" && url.username === "" && url.password === "";
    },
    { message: "The URL has no query, fragment or credentials." },
  )
  .refine((value) => !value.includes("?") && !value.includes("#"), {
    message: "The URL has no query or fragment.",
  });

/** Exactly one of `token` and `apiSecret`; shared with the pump connect (`schemas/pump.ts`). */
export const oneOfTokenOrApiSecret = (value: {
  token?: string | undefined;
  apiSecret?: string | undefined;
}) => (value.token === undefined) !== (value.apiSecret === undefined);
export const oneOfMessage = { message: "Exactly one of token and apiSecret.", path: ["token"] };

export const nightscoutSecrets = {
  token: z.string().min(1).max(200).optional(),
  apiSecret: z.string().min(1).max(200).optional(),
};

/** What `source-connect` stores in Key Vault for a Nightscout space (spec §3). */
export const NightscoutCredential = z
  .strictObject({ url: NightscoutUrl, ...nightscoutSecrets })
  .refine(oneOfTokenOrApiSecret, oneOfMessage);
export type NightscoutCredential = z.infer<typeof NightscoutCredential>;

export const SourceStatus = z.enum(["not-configured", "connected", "disconnected"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const ProbeResult = z.enum(["ok", "bad-credentials", "unreachable"]);
export type ProbeResult = z.infer<typeof ProbeResult>;

/** Settings route → the poller's `source-connect` function (plan §4). */
export const ConnectSourceRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dexcom-share"),
    spaceId: z.string().min(1),
    region: DexcomShareRegion,
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z
    .strictObject({
      type: z.literal("nightscout"),
      spaceId: z.string().min(1),
      url: NightscoutUrl,
      ...nightscoutSecrets,
    })
    .refine(oneOfTokenOrApiSecret, oneOfMessage),
  z.strictObject({ type: z.literal("manual"), spaceId: z.string().min(1) }),
]);
export type ConnectSourceRequest = z.infer<typeof ConnectSourceRequest>;

/**
 * A finger-prick value typed in by hand (plan §4). `value` is in `unit`; the route converts to
 * mmol and checks the window. `ts` is the time of the measurement and defaults to now.
 */
export const ManualReadingRequest = z.strictObject({
  ts: z.iso.datetime().default(() => new Date().toISOString()),
  value: z.number().positive().max(1000),
  unit: GlucoseUnit,
});
export type ManualReadingRequest = z.infer<typeof ManualReadingRequest>;

/**
 * `recentReadings` is how many readings the source returned for the last day once the login
 * worked: zero usually means a follower's login rather than the sharer's, or sharing turned off.
 * Absent when that read failed; the credential is stored either way.
 */
export const ConnectSourceResult = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("ok"),
    secretRef: z.string().min(1),
    recentReadings: z.number().int().nonnegative().optional(),
  }),
  z.object({ result: z.literal("bad-credentials") }),
  z.object({ result: z.literal("unreachable") }),
]);
export type ConnectSourceResult = z.infer<typeof ConnectSourceResult>;

/** The export formats an owner can import; `clarity` is Dexcom Clarity's CSV export (#154). */
export const GlucoseImportFormat = z.enum(["clarity"]);
export type GlucoseImportFormat = z.infer<typeof GlucoseImportFormat>;

/** 90 days of readings is about 3 MB; this leaves room for a generous export, not a stray file. */
export const MAX_IMPORT_CHARS = 20_000_000;

/** `POST /api/spaces/:id/import`: the file as text and whether its carb entries become meals. */
export const GlucoseImportRequest = z.strictObject({
  text: z.string().min(1).max(MAX_IMPORT_CHARS),
  createMeals: z.boolean().default(true),
});
export type GlucoseImportRequest = z.infer<typeof GlucoseImportRequest>;

/** Counts only: what was added, what was there already, what the file held that Frejsi keeps no record of. */
export const GlucoseImportResult = z.strictObject({
  format: GlucoseImportFormat,
  readings: z.strictObject({
    added: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    from: z.iso.datetime().nullable(),
    to: z.iso.datetime().nullable(),
  }),
  meals: z.strictObject({
    added: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  otherRows: z.number().int().nonnegative(),
});
export type GlucoseImportResult = z.infer<typeof GlucoseImportResult>;
