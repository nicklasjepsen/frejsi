import type { Logger } from "../../log";
import type { DexcomShareRegion, ProbeResult, Reading } from "../../schemas/glucose";
import { mgdlToMmol } from "../units";
import type { GlucoseSource } from "../types";
import {
  APPLICATION_ID,
  CREDENTIAL_CODES,
  ENDPOINTS,
  ErrorBody,
  GlucoseResponse,
  IdResponse,
  parseDotNetDate,
  SESSION_CODES,
  toTrend,
  windowFor,
} from "./protocol";
import { defaultFetch, type FetchLike, ReadOnlyEndpointError, sendShareRequest } from "./transport";

export type { FetchLike } from "./transport";

/** Well under the Function's four-minute invocation timeout, so one stalled space cannot starve the rest. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How long a credential the service refused is left alone before login is tried again. Dexcom
 * locks the account on repeated failed logins, so a wrong password must not be presented every
 * five minutes; a new password stored through `source-connect` replaces the instance and is tried
 * at once, and a lock that has cleared is noticed within this time.
 */
export const CREDENTIAL_RETRY_MS = 60 * 60_000;

export interface DexcomShareSourceOptions {
  region: DexcomShareRegion;
  username: string;
  password: string;
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives outcome codes only; never a credential, an id or a body. */
  log?: Logger;
  /** Deadline per call, headers and body together. */
  timeoutMs?: number;
  /** Time a refused credential is left alone before the next login attempt. */
  credentialRetryMs?: number;
}

/**
 * Anything the service refused or returned in an unexpected shape. The message is the code, so an
 * error that reaches a log line or a test output carries no response body.
 */
export class DexcomShareError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "DexcomShareError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The Dexcom Share adapter (spec §3): authenticate → login → latest values, the session kept for
 * the life of the instance and renewed once when the service says it is stale. One instance per
 * space per process is what keeps logins to one per process lifetime. Every call goes through
 * `sendShareRequest`, which sends allow-listed reads only: the adapter never writes to Dexcom.
 */
export class DexcomShareSource implements GlucoseSource {
  readonly fetch: FetchLike;
  private readonly region: DexcomShareRegion;
  private readonly username: string;
  private readonly password: string;
  private readonly now: () => Date;
  private readonly log: Logger | undefined;
  private readonly timeoutMs: number;
  private readonly credentialRetryMs: number;
  private sessionId: string | null = null;
  private loggingIn: Promise<string> | null = null;
  /** The last credential refusal, kept so the same password is not presented again before `until`. */
  private refused: { error: DexcomShareError; until: number } | null = null;

  constructor(options: DexcomShareSourceOptions) {
    this.region = options.region;
    this.username = options.username;
    this.password = options.password;
    this.fetch = options.fetch ?? defaultFetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.credentialRetryMs = options.credentialRetryMs ?? CREDENTIAL_RETRY_MS;
  }

  async fetchSince(since: Date): Promise<Reading[]> {
    const now = this.now();
    const { minutes, maxCount } = windowFor(since, now);
    let sessionId = await this.session();
    let entries: unknown;
    try {
      entries = await this.readLatest(sessionId, minutes, maxCount);
    } catch (error) {
      if (!(error instanceof DexcomShareError) || !SESSION_CODES.has(error.code)) throw error;
      this.log?.info("dexcom.session-renewed");
      this.sessionId = null;
      sessionId = await this.session();
      entries = await this.readLatest(sessionId, minutes, maxCount);
    }
    const parsed = GlucoseResponse.safeParse(entries);
    if (!parsed.success) throw new DexcomShareError("UnexpectedShape", 200);
    return parsed.data
      .map((entry) => ({
        ts: parseDotNetDate(entry.WT).toISOString(),
        mmol: mgdlToMmol(entry.Value),
        trend: toTrend(entry.Trend),
      }))
      .filter((reading) => Date.parse(reading.ts) > since.getTime())
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  }

  /** Logs in and keeps the session; a probe checks the credential and stores nothing else. */
  async probe(): Promise<ProbeResult> {
    try {
      // The session is kept: a fetch right after the probe (source-connect reads the last day)
      // reuses it instead of logging in a second time.
      this.sessionId = await this.login();
      return "ok";
    } catch (error) {
      const code = error instanceof DexcomShareError ? error.code : "network";
      this.log?.warn("dexcom.probe-failed", { code });
      return error instanceof DexcomShareError && CREDENTIAL_CODES.has(error.code)
        ? "bad-credentials"
        : "unreachable";
    }
  }

  private session(): Promise<string> {
    if (this.sessionId) return Promise.resolve(this.sessionId);
    // A credential the service refused is not presented again until the retry time: the cycle
    // keeps counting the failure, the account is not locked by our own retries.
    if (this.refused && this.now().getTime() < this.refused.until) {
      this.log?.warn("dexcom.login-withheld", { code: this.refused.error.code });
      return Promise.reject(this.refused.error);
    }
    this.refused = null;
    // Concurrent fetches share one login rather than each starting their own.
    this.loggingIn ??= this.login()
      .then((id) => {
        this.sessionId = id;
        return id;
      })
      .finally(() => {
        this.loggingIn = null;
      });
    return this.loggingIn;
  }

  private async login(): Promise<string> {
    try {
      const accountId = IdResponse.parse(
        await this.request(ENDPOINTS.authenticate, {
          accountName: this.username,
          password: this.password,
          applicationId: APPLICATION_ID,
        }),
      );
      return IdResponse.parse(
        await this.request(ENDPOINTS.login, {
          accountId,
          password: this.password,
          applicationId: APPLICATION_ID,
        }),
      );
    } catch (error) {
      if (error instanceof DexcomShareError && CREDENTIAL_CODES.has(error.code)) {
        this.refused = { error, until: this.now().getTime() + this.credentialRetryMs };
      }
      throw error;
    }
  }

  private readLatest(sessionId: string, minutes: number, maxCount: number): Promise<unknown> {
    const query = new URLSearchParams({
      sessionId,
      minutes: String(minutes),
      maxCount: String(maxCount),
    });
    return this.request(ENDPOINTS.glucose, undefined, query);
  }

  /** One of the three allow-listed calls; the transport refuses anything else before sending. */
  private async request(
    endpoint: (typeof ENDPOINTS)[keyof typeof ENDPOINTS],
    body: Record<string, string> | undefined,
    query?: URLSearchParams,
  ): Promise<unknown> {
    // One signal for the request and the body: a stall anywhere ends as a timeout, not a hang.
    const signal = AbortSignal.timeout(this.timeoutMs);
    let text: string;
    try {
      const response = await sendShareRequest(this.fetch, {
        region: this.region,
        ...endpoint,
        signal,
        ...(body === undefined ? {} : { body }),
        ...(query === undefined ? {} : { query }),
      });
      text = await response.text();
      return this.decode(response, text);
    } catch (error) {
      // A refused call is a programming error, never a network condition.
      if (error instanceof DexcomShareError || error instanceof ReadOnlyEndpointError) throw error;
      const code = signal.aborted ? "Timeout" : "Network";
      this.log?.warn("dexcom.unreachable", { code });
      throw new DexcomShareError(code, 0);
    }
  }

  private decode(response: Pick<Response, "ok" | "status">, text: string): unknown {
    let json: unknown = null;
    try {
      json = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      json = null;
    }
    if (response.ok) return json;
    const failure = ErrorBody.safeParse(json);
    const code = failure.success ? failure.data.Code : `Http${response.status}`;
    this.log?.warn("dexcom.request-failed", { code });
    throw new DexcomShareError(code, response.status);
  }
}
