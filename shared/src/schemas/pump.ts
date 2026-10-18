import { z } from "zod";

import {
  ConnectSourceRequest,
  NightscoutUrl,
  SourceStatus,
  nightscoutSecrets,
  oneOfMessage,
  oneOfTokenOrApiSecret,
} from "./glucose";

/**
 * The pump record (v0.7.0 plan §4): what the pump delivered, imported read-only and shown as
 * history to owners and carers outside simpleMode, never to a viewer, never to an AI model.
 * Nothing here computes, suggests or takes a dose; `units` is a number the pump recorded.
 */

/** Only `standard` and `extended` ever attach to a meal or make a pump meal. */
export const PumpBolusKind = z.enum(["standard", "extended", "automatic", "other"]);
export type PumpBolusKind = z.infer<typeof PumpBolusKind>;

const twoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const units = z.number().min(0).max(50).refine(twoDecimals, { message: "units have two decimals" });
const carbs = z.number().int().min(1).max(1000);
const timestamp = z.iso.datetime();

/** A bolus as the adapter returns it: the record's own id, its time, the delivered units, the kind. */
export const PumpBolus = z.strictObject({
  sourceId: z.string().min(1).max(100),
  ts: timestamp,
  units,
  kind: PumpBolusKind,
  /** Grams typed into the pump's calculator; absent when 0 or not recorded. */
  carbs: carbs.optional(),
});
export type PumpBolus = z.infer<typeof PumpBolus>;

/** Stored as JSON on `Space.pumpSource`. The address and the token are in Key Vault only. */
export const PumpSourceConfig = z.strictObject({
  type: z.literal("nightscout"),
  secretRef: z.string().min(1),
  connectedBy: z.string().min(1),
});
export type PumpSourceConfig = z.infer<typeof PumpSourceConfig>;

/** What the Settings form posts to the pump-source route: no `spaceId`, no `purpose`. */
export const ConnectPumpBody = z
  .strictObject({ type: z.literal("nightscout"), url: NightscoutUrl, ...nightscoutSecrets })
  .refine(oneOfTokenOrApiSecret, oneOfMessage);
export type ConnectPumpBody = z.infer<typeof ConnectPumpBody>;

/**
 * Pump-source route → the poller's `source-connect` function. Strict, and marked by `purpose`, so
 * it can never be read as a glucose connect and overwrite `glucose-<spaceId>`.
 */
export const ConnectPumpRequest = z
  .strictObject({
    purpose: z.literal("pump"),
    type: z.literal("nightscout"),
    spaceId: z.string().min(1),
    url: NightscoutUrl,
    ...nightscoutSecrets,
  })
  .refine(oneOfTokenOrApiSecret, oneOfMessage);
export type ConnectPumpRequest = z.infer<typeof ConnectPumpRequest>;

/** `recentBoluses` is how many the record held for the last day once the token worked. */
export const ConnectPumpResult = z.discriminatedUnion("result", [
  z.strictObject({
    result: z.literal("ok"),
    secretRef: z.string().min(1),
    recentBoluses: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ result: z.literal("bad-credentials") }),
  z.strictObject({ result: z.literal("unreachable") }),
]);
export type ConnectPumpResult = z.infer<typeof ConnectPumpResult>;

const hasPurpose = (value: unknown) =>
  typeof value === "object" && value !== null && "purpose" in value;

/**
 * The `source-connect` body, pump first: a body carrying `purpose` is parsed only as a
 * `ConnectPumpRequest`, so a pump connect never reaches the glucose secret even when the pump
 * schema rejects it; a body without `purpose` is a `ConnectSourceRequest` as before.
 */
export const SourceConnectBody = z.union([
  ConnectPumpRequest.transform((request) => ({ purpose: "pump" as const, request })),
  z
    .unknown()
    .refine((value) => !hasPurpose(value), { message: "A body with purpose is a pump connect." })
    .pipe(ConnectSourceRequest)
    .transform((request) => ({ purpose: "glucose" as const, request })),
]);
export type SourceConnectBody = z.infer<typeof SourceConnectBody>;

/** One bolus on the curve: the time with its units, the kind, the carbs and the meal it belongs to. */
export const PumpBolusView = z.strictObject({
  id: z.string().min(1),
  ts: timestamp,
  units,
  kind: PumpBolusKind,
  carbs: carbs.optional(),
  mealId: z.string().min(1).optional(),
});
export type PumpBolusView = z.infer<typeof PumpBolusView>;

/** `GET /api/spaces/:id/pump?from&to`; `reach` is how far the record goes (`lastPumpAt`). */
export const PumpHistoryView = z.strictObject({
  boluses: z.array(PumpBolusView),
  reach: timestamp.optional(),
  status: SourceStatus,
});
export type PumpHistoryView = z.infer<typeof PumpHistoryView>;

export const PUMP_RANGE_MAX_DAYS = 8;

export const PumpRangeQuery = z
  .strictObject({ from: timestamp, to: timestamp })
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), "from is before to")
  .refine(
    (value) => Date.parse(value.to) - Date.parse(value.from) <= PUMP_RANGE_MAX_DAYS * 86_400_000,
    `at most ${String(PUMP_RANGE_MAX_DAYS)} days`,
  );
export type PumpRangeQuery = z.infer<typeof PumpRangeQuery>;

/** The Settings card: the status and when it changed, the newest stored record, whether set up. */
export const PumpSettingsView = z.strictObject({
  status: SourceStatus,
  since: timestamp.optional(),
  lastPumpAt: timestamp.optional(),
  configured: z.boolean(),
});
export type PumpSettingsView = z.infer<typeof PumpSettingsView>;
