import { z } from "zod";

import type { DexcomShareRegion, Trend } from "../../schemas/glucose";

/**
 * The unofficial Dexcom Share protocol (spec §3): the one Dexcom Follow and `pydexcom` speak. This
 * file is the only place in the repo that knows the hosts and the application id (lint boundary).
 */
export const HOSTS: Record<DexcomShareRegion, string> = {
  eu: "shareous1.dexcom.com",
  us: "share2.dexcom.com",
};

/** The Dexcom Share application id every third-party Share client presents; it is not a secret. */
export const APPLICATION_ID = "d89443d2-327c-4a6f-89e5-496bbb0317db";

const BASE_PATH = "/ShareWebServices/Services";

/**
 * The three calls Frejsi makes, each with the method it takes. They are the whole allow-list in
 * `transport.ts`: the Share API also accepts writes with the same credential, and none is listed
 * (hard rule: glucose sources are read-only).
 */
export const ENDPOINTS = {
  authenticate: { method: "POST", path: `${BASE_PATH}/General/AuthenticatePublisherAccount` },
  login: { method: "POST", path: `${BASE_PATH}/General/LoginPublisherAccountById` },
  glucose: { method: "POST", path: `${BASE_PATH}/Publisher/ReadPublisherLatestGlucoseValues` },
} as const;

/** One call can ask for at most a day; the adapter clamps the window. */
export const MAX_MINUTES = 1440;
export const MINUTES_PER_READING = 5;

/** The service answers errors as HTTP 500 with this body. */
export const ErrorBody = z.object({ Code: z.string(), Message: z.string().optional() });

/** Codes that mean the session must be renewed (one retry) rather than the credential is wrong. */
export const SESSION_CODES = new Set(["SessionNotValid", "SessionIdNotFound"]);

/** Codes that mean the username or password is wrong, or the account is locked. */
export const CREDENTIAL_CODES = new Set([
  "AccountPasswordInvalid",
  "SSO_AuthenticateAccountNotFound",
  "SSO_AuthenticatePasswordInvalid",
  "SSO_AuthenticateMaxAttemptsExceeed",
  "SSO_AuthenticateMaxAttemptsExceeded",
  "SSO_InternalError",
  "AccountNotFound",
  "InvalidPassword",
]);

/** A JSON string: the account id from authenticate, the session id from login. */
export const IdResponse = z.string().min(1);

/** `WT` is the reading's UTC wall time as `Date(<epoch ms>)`; `DT` carries a local offset. */
const DotNetDate = z.string().regex(/^\/?Date\(-?\d+(?:[+-]\d{4})?\)\/?$/);

export const GlucoseEntry = z.object({
  WT: DotNetDate,
  Value: z.number(),
  Trend: z.union([z.string(), z.number().int()]),
});
export type GlucoseEntry = z.infer<typeof GlucoseEntry>;
export const GlucoseResponse = z.array(GlucoseEntry);

export function parseDotNetDate(value: string): Date {
  const match = /Date\((-?\d+)/.exec(value);
  if (!match?.[1]) throw new RangeError("not a Date(...) value");
  return new Date(Number(match[1]));
}

/** Dexcom's trend vocabulary, in the order of its numeric form (0 = None). */
const TREND_NAMES = [
  "None",
  "DoubleUp",
  "SingleUp",
  "FortyFiveUp",
  "Flat",
  "FortyFiveDown",
  "SingleDown",
  "DoubleDown",
  "NotComputable",
  "RateOutOfRange",
] as const;

const TREND_BY_NAME: Record<(typeof TREND_NAMES)[number], Trend> = {
  None: "not-computable",
  DoubleUp: "double-up",
  SingleUp: "single-up",
  FortyFiveUp: "forty-five-up",
  Flat: "flat",
  FortyFiveDown: "forty-five-down",
  SingleDown: "single-down",
  DoubleDown: "double-down",
  NotComputable: "not-computable",
  RateOutOfRange: "rate-out-of-range",
};

/** Both forms the service has used over the years; anything unknown is `not-computable`. */
export function toTrend(value: string | number): Trend {
  const name = typeof value === "number" ? TREND_NAMES[value] : value;
  if (name && name in TREND_BY_NAME) return TREND_BY_NAME[name as keyof typeof TREND_BY_NAME];
  return "not-computable";
}

/** The window for a `since` at `now`: whole minutes, at least one, at most a day. */
export function windowFor(since: Date, now: Date): { minutes: number; maxCount: number } {
  const elapsed = Math.ceil((now.getTime() - since.getTime()) / 60_000);
  const minutes = Math.min(MAX_MINUTES, Math.max(1, elapsed));
  return { minutes, maxCount: Math.ceil(minutes / MINUTES_PER_READING) };
}
