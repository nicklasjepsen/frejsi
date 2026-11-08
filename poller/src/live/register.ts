import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { HttpResponseInit } from "@azure/functions";
import {
  LIVE_DEMO_URL,
  LiveRegisterRequest,
  LiveSubscriptionId,
  liveSecretName,
  NightscoutError,
  NightscoutSource,
  parseNightscoutCredential,
  serializeNightscoutCredential,
  type FetchLike,
  type LiveRegisterCreated,
  type LiveRegisterError,
  type LiveRegisterErrorCode,
  type LiveRegisterUpdated,
  type Logger,
  type Secrets,
} from "@naensom/shared";

import { removeSubscription } from "./relay";
import type { LivePatch, LiveRow, LiveStore } from "./store";

/**
 * `POST /api/live/register` and `DELETE /api/live/register/{subscriptionId}` (plan
 * 2026-11-08-ios-follower-app §4): anonymous HTTP functions the iPhone app calls. A create checks
 * the Nightscout token by reading one entry (read-only, allow-listed), stores address and token in
 * Key Vault as `live-<id>`, and answers a random device secret once; the relay keeps only its
 * SHA-256. Update and delete need that secret in `x-device-secret`.
 *
 * Rate limits are per client IP and in memory, per Function App instance: a scaled-out app has a
 * limit per instance, which is enough to stop one phone or script from hammering the relay or a
 * Nightscout site through it. Nothing here logs an address, a token, a secret or an IP.
 */

export const DEVICE_SECRET_HEADER = "x-device-secret";
/** The body is a few hundred bytes; anything far larger is not the app. */
export const MAX_BODY_BYTES = 16 * 1024;

/** Every request: 60 per IP in 10 minutes (the app registers on each launch and wake). */
export const REQUEST_LIMIT = { max: 60, windowMs: 10 * 60_000 } as const;
/** Requests that read a Nightscout site or create a subscription: 10 per IP an hour. */
export const CHECK_LIMIT = { max: 10, windowMs: 60 * 60_000 } as const;
/** The Nightscout check's deadline; the app waits for it. */
export const VALIDATE_TIMEOUT_MS = 10_000;

/** A fixed-window counter per key, in memory. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True when the key may go ahead now; counts the attempt. */
  take(key: string, now: number): boolean {
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    }
    const window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    window.count += 1;
    return window.count <= this.max;
  }
}

export type NightscoutVerdict = "ok" | "refused" | "unreachable";

/** Reads one entry with the token; 401 or 403 is refused, anything else that fails unreachable. */
export function nightscoutValidator(fetch?: FetchLike) {
  return async (url: string, token: string): Promise<NightscoutVerdict> => {
    const source = new NightscoutSource({
      url,
      token,
      timeoutMs: VALIDATE_TIMEOUT_MS,
      ...(fetch === undefined ? {} : { fetch }),
    });
    try {
      await source.latestEntries(1);
      return "ok";
    } catch (error) {
      if (error instanceof NightscoutError && (error.code === "401" || error.code === "403")) {
        return "refused";
      }
      return "unreachable";
    }
  };
}

/** The slice of an Azure Functions `HttpRequest` the handlers use. */
export interface LiveHttpRequest {
  headers: { get(name: string): string | null };
  params?: Record<string, string | undefined>;
  text(): Promise<string>;
}

export interface RegisterDeps {
  store: LiveStore;
  secrets: Secrets;
  validate: (url: string, token: string) => Promise<NightscoutVerdict>;
  requests: RateLimiter;
  checks: RateLimiter;
  now: () => number;
  log: Logger;
  newId?: () => string;
  newSecret?: () => string;
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Constant-time: both sides are SHA-256 digests of the same length. */
export function deviceSecretMatches(secret: string | null, storedHash: string): boolean {
  if (secret === null || secret.length === 0 || secret.length > 200) return false;
  const given = Buffer.from(hashDeviceSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return stored.length === given.length && timingSafeEqual(given, stored);
}

/** The first `x-forwarded-for` hop without its port (Azure puts `ip:port` there). */
export function clientIp(request: LiveHttpRequest): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (first === "") return "unknown";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(first);
  if (bracketed?.[1] !== undefined) return bracketed[1];
  // One colon is IPv4 with a port; more is a bare IPv6 address.
  if (first.split(":").length === 2) return first.split(":")[0] ?? first;
  return first;
}

const error = (status: number, code: LiveRegisterErrorCode): HttpResponseInit => {
  const body: LiveRegisterError = { error: code };
  return { status, jsonBody: body };
};

/** Parses the body; a URL that is a URL but not https answers `not-https`. */
async function parseBody(
  request: LiveHttpRequest,
): Promise<{ ok: true; data: LiveRegisterRequest } | { ok: false; code: LiveRegisterErrorCode }> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { ok: false, code: "validation" };
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, code: "validation" };
  }
  const parsed = LiveRegisterRequest.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const url = (json as { nightscoutUrl?: unknown } | null)?.nightscoutUrl;
  if (typeof url === "string" && url !== LIVE_DEMO_URL && URL.canParse(url)) {
    if (new URL(url).protocol !== "https:") return { ok: false, code: "not-https" };
  }
  return { ok: false, code: "validation" };
}

function hostOf(url: string): string {
  return new URL(url).hostname.slice(0, 253);
}

/** The fields every create and update writes from the body. */
function settingsFrom(data: LiveRegisterRequest): LivePatch {
  return {
    apnsEnvironment: data.apnsEnvironment,
    unit: data.unit,
    language: data.language,
    urgentLowMgdl: data.thresholds.urgentLowMgdl,
    lowMgdl: data.thresholds.lowMgdl,
    highMgdl: data.thresholds.highMgdl,
    urgentHighMgdl: data.thresholds.urgentHighMgdl,
    alertsOn: data.alertsOn,
  };
}

export function createLiveRegisterHandler(deps: RegisterDeps) {
  const newId = deps.newId ?? randomUUID;
  const newSecret = deps.newSecret ?? (() => randomBytes(32).toString("base64url"));

  /** Checks the token against the site and writes `live-<id>`; a response when it failed. */
  const storeCredential = async (
    id: string,
    url: string,
    token: string,
    ip: string,
  ): Promise<{ ref: string } | { response: HttpResponseInit }> => {
    if (!deps.checks.take(ip, deps.now())) return { response: error(429, "rate-limited") };
    const verdict = await deps.validate(url, token);
    if (verdict !== "ok") {
      deps.log.warn("live.register-refused", { subscriptionId: id, code: verdict });
      return {
        response: error(
          422,
          verdict === "refused" ? "nightscout-refused" : "nightscout-unreachable",
        ),
      };
    }
    const ref = await deps.secrets.set(
      liveSecretName(id),
      serializeNightscoutCredential({ url, token }),
    );
    return { ref };
  };

  const create = async (data: LiveRegisterRequest, ip: string): Promise<HttpResponseInit> => {
    const demo = data.nightscoutUrl === LIVE_DEMO_URL;
    const token = data.nightscoutToken;
    const id = newId();
    let tokenSecretRef: string | null = null;
    if (demo) {
      // A demo subscription reads no site, but it is still a write: count it like one.
      if (!deps.checks.take(ip, deps.now())) return error(429, "rate-limited");
    } else {
      if (token === undefined) return error(400, "validation");
      const stored = await storeCredential(id, data.nightscoutUrl, token, ip);
      if ("response" in stored) return stored.response;
      tokenSecretRef = stored.ref;
    }
    const deviceSecret = newSecret();
    const now = new Date(deps.now());
    const row: LiveRow = {
      id,
      deviceSecretHash: hashDeviceSecret(deviceSecret),
      isDemo: demo,
      nightscoutHost: demo ? null : hostOf(data.nightscoutUrl),
      tokenSecretRef,
      apnsEnvironment: data.apnsEnvironment,
      pushToStartToken: data.pushToStartToken ?? null,
      activityPushToken: data.activityPushToken ?? null,
      activityStartedAt:
        data.activityStartedAt === undefined || data.activityStartedAt === null
          ? null
          : new Date(data.activityStartedAt),
      deviceToken: data.deviceToken ?? null,
      unit: data.unit,
      language: data.language,
      urgentLowMgdl: data.thresholds.urgentLowMgdl,
      lowMgdl: data.thresholds.lowMgdl,
      highMgdl: data.thresholds.highMgdl,
      urgentHighMgdl: data.thresholds.urgentHighMgdl,
      alertsOn: data.alertsOn,
      lastAlertKind: null,
      lastAlertAt: null,
      lastReadingAt: null,
      lastPushAt: null,
      // The first check runs on the next minute's timer.
      nextCheckAt: now,
      failures: 0,
      createdAt: now,
      lastSeenAt: now,
    };
    try {
      await deps.store.create(row);
    } catch (cause) {
      // Leave no secret behind for a row that was never written.
      if (tokenSecretRef !== null)
        await deps.secrets.delete(liveSecretName(id)).catch(() => undefined);
      throw cause;
    }
    deps.log.info("live.register", { subscriptionId: id, code: demo ? "created-demo" : "created" });
    const body: LiveRegisterCreated = { subscriptionId: id, deviceSecret };
    return { status: 200, jsonBody: body };
  };

  const update = async (
    id: string,
    data: LiveRegisterRequest,
    request: LiveHttpRequest,
    ip: string,
  ): Promise<HttpResponseInit> => {
    const row = await deps.store.get(id);
    // A missing subscription and a wrong secret answer the same, so neither is an oracle.
    if (
      row === null ||
      !deviceSecretMatches(request.headers.get(DEVICE_SECRET_HEADER), row.deviceSecretHash)
    ) {
      deps.log.warn("live.register-denied", { code: row === null ? "unknown-id" : "bad-secret" });
      return error(401, "bad-device-secret");
    }
    const now = deps.now();
    const patch: LivePatch = { ...settingsFrom(data), lastSeenAt: new Date(now) };
    let restartReading = false;

    if (data.nightscoutUrl === LIVE_DEMO_URL) {
      if (row.tokenSecretRef !== null) await deps.secrets.delete(liveSecretName(id));
      if (!row.isDemo) restartReading = true;
      Object.assign(patch, { isDemo: true, nightscoutHost: null, tokenSecretRef: null });
    } else {
      const storedValue =
        row.tokenSecretRef === null ? undefined : await deps.secrets.get(row.tokenSecretRef);
      const stored = storedValue === undefined ? undefined : parseNightscoutCredential(storedValue);
      const token = data.nightscoutToken ?? stored?.token;
      if (token === undefined) return error(400, "validation");
      if (stored?.url !== data.nightscoutUrl || stored.token !== token) {
        const written = await storeCredential(id, data.nightscoutUrl, token, ip);
        if ("response" in written) return written.response;
        Object.assign(patch, {
          isDemo: false,
          nightscoutHost: hostOf(data.nightscoutUrl),
          tokenSecretRef: written.ref,
        });
        restartReading = true;
      }
    }

    if (data.pushToStartToken !== undefined) patch.pushToStartToken = data.pushToStartToken;
    if (data.deviceToken !== undefined) patch.deviceToken = data.deviceToken;
    if (data.activityPushToken !== undefined || data.activityStartedAt !== undefined) {
      const startedAt =
        data.activityStartedAt === undefined || data.activityStartedAt === null
          ? null
          : new Date(data.activityStartedAt);
      // An activity older than the one the relay already knows (the app reporting the activity the
      // 8-hour restart just ended) is ignored; anything else is the app's current state.
      const older =
        startedAt !== null &&
        row.activityStartedAt !== null &&
        startedAt.getTime() < row.activityStartedAt.getTime();
      if (!older) {
        const token =
          data.activityPushToken === undefined ? row.activityPushToken : data.activityPushToken;
        if (token !== row.activityPushToken) restartReading = true;
        patch.activityPushToken = token;
        patch.activityStartedAt = startedAt;
      }
    }
    if (!data.alertsOn) {
      patch.lastAlertKind = null;
      patch.lastAlertAt = null;
    }
    if (restartReading) {
      // A new activity or a new site gets the newest reading on the next run, not five minutes on.
      patch.lastReadingAt = null;
      patch.nextCheckAt = new Date(now);
    }
    await deps.store.update(id, patch);
    deps.log.info("live.register", { subscriptionId: id, code: "updated" });
    const body: LiveRegisterUpdated = { subscriptionId: id };
    return { status: 200, jsonBody: body };
  };

  return async (request: LiveHttpRequest): Promise<HttpResponseInit> => {
    const ip = clientIp(request);
    if (!deps.requests.take(ip, deps.now())) return error(429, "rate-limited");
    const parsed = await parseBody(request);
    if (!parsed.ok) {
      deps.log.warn("live.register-invalid", { code: parsed.code });
      return error(400, parsed.code);
    }
    const id = parsed.data.subscriptionId;
    return id === undefined ? create(parsed.data, ip) : update(id, parsed.data, request, ip);
  };
}

export interface UnregisterDeps {
  store: LiveStore;
  secrets: Pick<Secrets, "delete">;
  requests: RateLimiter;
  now: () => number;
  log: Logger;
}

/** "Remove this phone": the row and `live-<id>` go; 204 also when the subscription is already gone. */
export function createLiveUnregisterHandler(deps: UnregisterDeps) {
  return async (request: LiveHttpRequest): Promise<HttpResponseInit> => {
    if (!deps.requests.take(clientIp(request), deps.now())) return error(429, "rate-limited");
    const id = LiveSubscriptionId.safeParse(request.params?.subscriptionId);
    if (!id.success) return error(400, "validation");
    const row = await deps.store.get(id.data);
    if (row === null) return { status: 204 };
    if (!deviceSecretMatches(request.headers.get(DEVICE_SECRET_HEADER), row.deviceSecretHash)) {
      deps.log.warn("live.unregister-denied", { subscriptionId: row.id, code: "bad-secret" });
      return error(401, "bad-device-secret");
    }
    await removeSubscription(deps, row);
    deps.log.info("live.removed", { subscriptionId: row.id, code: "unregistered" });
    return { status: 204 };
  };
}
