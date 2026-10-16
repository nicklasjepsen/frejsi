import type { Logger } from "../../log";
import type { NightscoutCredential, ProbeResult, Reading } from "../../schemas/glucose";
import type { GlucoseSource } from "../types";
import { mgdlToMmol } from "../units";
import {
  countFor,
  ENDPOINTS,
  EntriesResponse,
  judgeVerifyAuth,
  SgvEntry,
  toTrend,
} from "./protocol";
import {
  defaultFetch,
  type FetchLike,
  ReadOnlyEndpointError,
  sendNightscoutRequest,
} from "./transport";

export type { FetchLike } from "./transport";

/** Well under the Function's four-minute invocation timeout, so one stalled site cannot starve the rest. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface NightscoutSourceOptions extends Pick<NightscoutCredential, "url"> {
  token?: string | undefined;
  apiSecret?: string | undefined;
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives outcome codes only; never the address, the credential or a body. */
  log?: Logger;
  /** Deadline per call, headers and body together. */
  timeoutMs?: number;
}

/**
 * Anything the site refused or returned in an unexpected shape. `code` is the HTTP status
 * (`"401"`) or one of `Timeout`, `Network`, `UnexpectedShape`; the message is the code, so an error
 * that reaches a log line carries no address and no response body.
 */
export class NightscoutError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "NightscoutError";
    this.code = code;
    this.status = status;
  }
}

/**
 * The Nightscout adapter (spec §3): `GET entries/sgv.json` for the readings and `GET verifyauth`
 * for the probe, both with the credential in the `api-secret` header. No session, no state. Every
 * call goes through `sendNightscoutRequest`, which sends allow-listed reads only: the adapter never
 * writes to a Nightscout site.
 */
export class NightscoutSource implements GlucoseSource {
  readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly auth: Pick<NightscoutCredential, "token" | "apiSecret">;
  private readonly now: () => Date;
  private readonly log: Logger | undefined;
  private readonly timeoutMs: number;

  constructor(options: NightscoutSourceOptions) {
    this.baseUrl = options.url;
    this.auth = { token: options.token, apiSecret: options.apiSecret };
    this.fetch = options.fetch ?? defaultFetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchSince(since: Date): Promise<Reading[]> {
    const query = new URLSearchParams({
      "find[date][$gte]": String(since.getTime()),
      count: String(countFor(since, this.now())),
    });
    const body = await this.request(ENDPOINTS.entries, query);
    const list = EntriesResponse.safeParse(body);
    if (!list.success) throw new NightscoutError("UnexpectedShape", 200);

    const byDate = new Map<number, Reading>();
    for (const raw of list.data) {
      const entry = SgvEntry.safeParse(raw);
      if (!entry.success || entry.data.date <= since.getTime()) continue;
      if (byDate.has(entry.data.date)) continue;
      byDate.set(entry.data.date, {
        ts: new Date(entry.data.date).toISOString(),
        mmol: mgdlToMmol(entry.data.sgv),
        trend: toTrend(entry.data.direction),
      });
    }
    return [...byDate.entries()].sort(([a], [b]) => a - b).map(([, reading]) => reading);
  }

  /** "ok" means the site answered `verifyauth` with read access, with this credential or without one. */
  async probe(): Promise<ProbeResult> {
    try {
      const verdict = judgeVerifyAuth(await this.request(ENDPOINTS.verifyauth));
      if (verdict === "ok") return "ok";
      this.log?.warn("nightscout.probe-failed", { code: verdict });
      return verdict === "bad-credentials" ? "bad-credentials" : "unreachable";
    } catch (error) {
      const code = error instanceof NightscoutError ? error.code : "Network";
      this.log?.warn("nightscout.probe-failed", { code });
      return code === "401" || code === "403" ? "bad-credentials" : "unreachable";
    }
  }

  /** One of the two allow-listed calls; the transport refuses anything else before sending. */
  private async request(
    endpoint: (typeof ENDPOINTS)[keyof typeof ENDPOINTS],
    query?: URLSearchParams,
  ): Promise<unknown> {
    // One signal for the request and the body: a stall anywhere ends as a timeout, not a hang.
    const signal = AbortSignal.timeout(this.timeoutMs);
    let status: number;
    let text: string;
    try {
      const response = await sendNightscoutRequest(this.fetch, {
        baseUrl: this.baseUrl,
        ...endpoint,
        auth: this.auth,
        signal,
        ...(query === undefined ? {} : { query }),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      // A refused call is a programming error, never a network condition.
      if (error instanceof ReadOnlyEndpointError) throw error;
      const code = signal.aborted ? "Timeout" : "Network";
      this.log?.warn("nightscout.unreachable", { code });
      throw new NightscoutError(code, 0);
    }
    return this.decode(status, text);
  }

  /** A 2xx body as JSON; any other status (a 3xx is not followed) as an error that carries the status only. */
  private decode(status: number, text: string): unknown {
    if (status < 200 || status >= 300) {
      this.log?.warn("nightscout.request-failed", { code: String(status) });
      throw new NightscoutError(String(status), status);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      this.log?.warn("nightscout.request-failed", { code: "UnexpectedShape" });
      throw new NightscoutError("UnexpectedShape", status);
    }
  }
}
