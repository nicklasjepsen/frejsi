import { z } from "zod";

import type { Trend } from "../../schemas/glucose";

/**
 * The Nightscout REST API v1 as Frejsi reads it. This file and `transport.ts` are the only places
 * in the repo that know the paths and the auth header (lint boundary). A Nightscout site is the
 * person's own server, so there is no host here: the URL comes from the credential.
 */
export const ENDPOINTS = {
  entries: { method: "GET", path: "/api/v1/entries/sgv.json" },
  verifyauth: { method: "GET", path: "/api/v1/verifyauth" },
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
