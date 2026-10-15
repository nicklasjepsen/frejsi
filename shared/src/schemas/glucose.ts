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

export const GlucoseSourceType = z.enum(["dexcom-share"]);
export type GlucoseSourceType = z.infer<typeof GlucoseSourceType>;

export const DexcomShareRegion = z.enum(["eu", "us"]);
export type DexcomShareRegion = z.infer<typeof DexcomShareRegion>;

/** Stored as JSON on `Space.glucoseSource`. The credential lives in Key Vault under `secretRef`. */
export const GlucoseSourceConfig = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dexcom-share"),
    region: DexcomShareRegion,
    secretRef: z.string().min(1),
  }),
]);
export type GlucoseSourceConfig = z.infer<typeof GlucoseSourceConfig>;

export const SourceStatus = z.enum(["not-configured", "connected", "disconnected"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const ProbeResult = z.enum(["ok", "bad-credentials", "unreachable"]);
export type ProbeResult = z.infer<typeof ProbeResult>;

/** Settings route → the poller's `source-connect` function (plan §4). */
export const ConnectSourceRequest = z.object({
  spaceId: z.string().min(1),
  type: GlucoseSourceType,
  region: DexcomShareRegion,
  username: z.string().min(1),
  password: z.string().min(1),
});
export type ConnectSourceRequest = z.infer<typeof ConnectSourceRequest>;

export const ConnectSourceResult = z.discriminatedUnion("result", [
  z.object({ result: z.literal("ok"), secretRef: z.string().min(1) }),
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
