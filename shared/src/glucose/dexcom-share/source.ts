import type { Logger } from "../../log";
import type { DexcomShareRegion, ProbeResult, Reading } from "../../schemas/glucose";
import { mgdlToMmol } from "../units";
import type { GlucoseSource } from "../types";
import {
  APPLICATION_ID,
  CREDENTIAL_CODES,
  ErrorBody,
  GlucoseResponse,
  HOSTS,
  IdResponse,
  PATHS,
  parseDotNetDate,
  SESSION_CODES,
  toTrend,
  windowFor,
} from "./protocol";

/** The slice of `fetch` the adapter uses; tests pass one that serves the fixtures. */
export type FetchLike = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export interface DexcomShareSourceOptions {
  region: DexcomShareRegion;
  username: string;
  password: string;
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives outcome codes only; never a credential, an id or a body. */
  log?: Logger;
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

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
  "user-agent": "Frejsi",
};

/**
 * The Dexcom Share adapter (spec §3): authenticate → login → latest values, the session kept for
 * the life of the instance and renewed once when the service says it is stale. One instance per
 * space per process is what keeps logins to one per process lifetime.
 */
export class DexcomShareSource implements GlucoseSource {
  readonly fetch: FetchLike;
  private readonly region: DexcomShareRegion;
  private readonly username: string;
  private readonly password: string;
  private readonly now: () => Date;
  private readonly log: Logger | undefined;
  private sessionId: string | null = null;
  private loggingIn: Promise<string> | null = null;

  constructor(options: DexcomShareSourceOptions) {
    this.region = options.region;
    this.username = options.username;
    this.password = options.password;
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
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

  /** Logs in and throws the session away: a probe checks the credential, it stores nothing. */
  async probe(): Promise<ProbeResult> {
    try {
      await this.login();
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
    const accountId = IdResponse.parse(
      await this.post(PATHS.authenticate, {
        accountName: this.username,
        password: this.password,
        applicationId: APPLICATION_ID,
      }),
    );
    return IdResponse.parse(
      await this.post(PATHS.login, {
        accountId,
        password: this.password,
        applicationId: APPLICATION_ID,
      }),
    );
  }

  private readLatest(sessionId: string, minutes: number, maxCount: number): Promise<unknown> {
    const query = new URLSearchParams({
      sessionId,
      minutes: String(minutes),
      maxCount: String(maxCount),
    });
    return this.post(`${PATHS.glucose}?${query.toString()}`, undefined);
  }

  private async post(
    pathAndQuery: string,
    body: Record<string, string> | undefined,
  ): Promise<unknown> {
    const url = `https://${HOSTS[this.region]}${pathAndQuery}`;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers: HEADERS,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      this.log?.warn("dexcom.unreachable", { code: "network" });
      throw new DexcomShareError("Network", 0);
    }
    const text = await response.text();
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
