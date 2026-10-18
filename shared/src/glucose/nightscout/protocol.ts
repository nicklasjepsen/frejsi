import { z } from "zod";

import type { Trend } from "../../schemas/glucose";
import type { PumpBolusKind } from "../../schemas/pump";

/**
 * The Nightscout REST API v1 as Frejsi reads it. This file and `transport.ts` are the only places
 * in the repo that know the paths and the auth header (lint boundary). A Nightscout site is the
 * person's own server, so there is no host here: the URL comes from the credential.
 */
export const ENDPOINTS = {
  entries: { method: "GET", path: "/api/v1/entries/sgv.json" },
  verifyauth: { method: "GET", path: "/api/v1/verifyauth" },
  /** The pump record (v0.7.0 plan §5): read with `find[eventType]=Combo Bolus` only. */
  treatments: { method: "GET", path: "/api/v1/treatments.json" },
} as const;

/** The request header Nightscout reads its API secret hash or access token from. */
export const AUTH_HEADER = "api-secret";

export const MINUTE_MS = 60_000;
export const MINUTES_PER_READING = 5;
/** A day of readings: the first-run window (spec §3). */
export const MAX_COUNT = 288;

/** How many entries to ask for: one per five minutes of the window, at most a day's worth. */
export function countFor(since: Date, now: Date): number {
  const minutes = Math.max(0, (now.getTime() - since.getTime()) / MINUTE_MS);
  return Math.min(MAX_COUNT, Math.max(1, Math.ceil(minutes / MINUTES_PER_READING)));
}

/** `direction` words Nightscout writes, mapped to Dexcom's trend set; anything else is not computable. */
const DIRECTIONS: Partial<Record<string, Trend>> = {
  DoubleUp: "double-up",
  SingleUp: "single-up",
  FortyFiveUp: "forty-five-up",
  Flat: "flat",
  FortyFiveDown: "forty-five-down",
  SingleDown: "single-down",
  DoubleDown: "double-down",
  "RATE OUT OF RANGE": "rate-out-of-range",
  NONE: "not-computable",
  "NOT COMPUTABLE": "not-computable",
};

export function toTrend(direction: unknown): Trend {
  if (typeof direction !== "string") return "not-computable";
  return DIRECTIONS[direction] ?? "not-computable";
}

/** The two fields a reading needs; `sgv` is always mg/dL in the API whatever the site displays. */
export const SgvEntry = z.object({
  type: z.literal("sgv").optional(),
  sgv: z.number().min(1).max(720),
  date: z.number().int().positive(),
  direction: z.unknown().optional(),
});

export const EntriesResponse = z.array(z.unknown());

/** The newer `verifyauth` body: `message` is an object with the roles. */
const VerifyAuthRoles = z.object({ canRead: z.boolean() });

export type VerifyAuthVerdict = "ok" | "bad-credentials" | "unexpected";

/** Reads `verifyauth`'s body: `"OK"` (older sites), `{ canRead }` (newer) or `"UNAUTHORIZED"`. */
export function judgeVerifyAuth(body: unknown): VerifyAuthVerdict {
  if (typeof body !== "object" || body === null || !("message" in body)) return "unexpected";
  const { message } = body;
  if (message === "OK") return "ok";
  if (message === "UNAUTHORIZED") return "bad-credentials";
  const roles = VerifyAuthRoles.safeParse(message);
  if (roles.success) return roles.data.canRead ? "ok" : "bad-credentials";
  return "unexpected";
}

/**
 * The treatment type tconnectsync writes for every bolus (v0.7.0 plan §5). Temp Basal, Sleep and
 * every other type are filtered out in the query and never reach Frejsi.
 */
export const BOLUS_EVENT_TYPE = "Combo Bolus";
/** Records per page on a normal window, and on a first run (or a catch-up longer than a normal day). */
export const PAGE_COUNT = 200;
export const FIRST_RUN_PAGE_COUNT = 1000;
/** Pages read per call at most; a fuller record is picked up by the next cycle. */
export const MAX_PAGES = 5;
/** A normal window: a day, plus three hours behind the newest stored bolus (plan §5). */
export const NORMAL_WINDOW_MS = 27 * 60 * MINUTE_MS;

/** How many records to ask for per page: the large page for a window longer than a normal one. */
export function pageCountFor(since: Date, now: Date): number {
  return now.getTime() - since.getTime() > NORMAL_WINDOW_MS ? FIRST_RUN_PAGE_COUNT : PAGE_COUNT;
}

/** `notes` words tconnectsync writes on a Combo Bolus, mapped to the kind; anything else is `other`. */
const KINDS: Partial<Record<string, PumpBolusKind>> = {
  "Standard Bolus": "standard",
  "BLE Standard Bolus": "standard",
  "Extended Bolus": "extended",
  "Automatic Bolus": "automatic",
};

export function toKind(notes: unknown): PumpBolusKind {
  if (typeof notes !== "string") return "other";
  return KINDS[notes] ?? "other";
}

/**
 * The five fields a bolus needs, and nothing else: `glucose`, `enteredBy`, `utcOffset`, `_id` and
 * every other key of the record are never read beyond this parse. `insulin` is Nightscout's own
 * name for the delivered units. `created_at` is UTC.
 */
export const TreatmentEntry = z.object({
  eventType: z.string().nullish(),
  pump_event_id: z.union([z.string().min(1).max(100), z.number().int().nonnegative()]),
  created_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  insulin: z.number().min(0).max(50),
  // tconnectsync writes null, not a missing key, when the pump has no calculator carbs.
  carbs: z.number().nullish(),
  notes: z.unknown().optional(),
});
export type TreatmentEntry = z.infer<typeof TreatmentEntry>;

export const TreatmentsResponse = z.array(z.unknown());
