import type { Logger } from "../../log";
import type { NightscoutCredential, ProbeResult } from "../../schemas/glucose";
import { PumpBolus } from "../../schemas/pump";
import type { PumpSource } from "../../pump/types";
import {
  BOLUS_EVENT_TYPE,
  ENDPOINTS,
  MAX_PAGES,
  pageCountFor,
  toKind,
  TreatmentEntry,
  TreatmentsResponse,
} from "./protocol";
import { DEFAULT_TIMEOUT_MS, NightscoutError, NightscoutSource } from "./source";
import {
  defaultFetch,
  type FetchLike,
  ReadOnlyEndpointError,
  sendNightscoutRequest,
} from "./transport";

export interface NightscoutPumpSourceOptions extends Pick<NightscoutCredential, "url"> {
  token?: string | undefined;
  apiSecret?: string | undefined;
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives outcome codes and counts only; never the address, the credential, a body or units. */
  log?: Logger;
  /** Deadline per call, headers and body together. */
  timeoutMs?: number;
}

/** One page as read: the boluses it held, how many rows it had, and the oldest `created_at`. */
interface Page {
  rows: number;
  oldest: string | undefined;
  boluses: PumpBolus[];
  dropped: number;
}

/**
 * The pump record from a Nightscout site (v0.7.0 plan §5): `GET treatments.json` filtered on
 * `eventType=Combo Bolus`, which is what tconnectsync writes for every bolus, and `GET verifyauth`
 * for the probe. Read-only like `NightscoutSource`, on the same transport and error type: every
 * call goes through `sendNightscoutRequest`, which refuses anything but the allow-listed reads.
 */
export class NightscoutPumpSource implements PumpSource {
  readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly auth: Pick<NightscoutCredential, "token" | "apiSecret">;
  private readonly now: () => Date;
  private readonly log: Logger | undefined;
  private readonly timeoutMs: number;
  /** The glucose adapter's probe: one `verifyauth` reading, one verdict, for both connections. */
  private readonly verifier: NightscoutSource;

  constructor(options: NightscoutPumpSourceOptions) {
    this.baseUrl = options.url;
    this.auth = { token: options.token, apiSecret: options.apiSecret };
    this.fetch = options.fetch ?? defaultFetch;
    this.now = options.now ?? (() => new Date());
    this.log = options.log;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.verifier = new NightscoutSource({
      url: options.url,
      token: options.token,
      apiSecret: options.apiSecret,
      fetch: this.fetch,
      now: this.now,
      timeoutMs: this.timeoutMs,
      ...(options.log === undefined ? {} : { log: options.log }),
    });
  }

  /**
   * Boluses recorded at or after `since`, oldest first, one per `pump_event_id`. Nightscout answers
   * newest first; while a page comes back full the next one asks below the oldest record seen, at
   * most five pages. A record that cannot be read is dropped and counted in one `pump.dropped` line.
   */
  async fetchBolusesSince(since: Date): Promise<PumpBolus[]> {
    const count = pageCountFor(since, this.now());
    const bySourceId = new Map<string, PumpBolus>();
    let dropped = 0;
    let below: string | undefined;
    for (let index = 0; index < MAX_PAGES; index += 1) {
      const query = new URLSearchParams({
        "find[created_at][$gte]": since.toISOString(),
        "find[eventType]": BOLUS_EVENT_TYPE,
        count: String(count),
      });
      if (below !== undefined) query.set("find[created_at][$lt]", below);
      const page = await this.readPage(query, since);
      dropped += page.dropped;
      for (const bolus of page.boluses) {
        if (!bySourceId.has(bolus.sourceId)) bySourceId.set(bolus.sourceId, bolus);
      }
      if (page.rows < count || page.oldest === undefined) break;
      if (index === MAX_PAGES - 1) {
        // A guard against a runaway answer, not a cursor: records older than the fifth page are
        // not read, now or later. Five pages hold far more than a 14-day window of boluses.
        this.log?.warn("pump.page-cap", { count: MAX_PAGES * count, code: "page-cap" });
        break;
      }
      below = page.oldest;
    }
    if (dropped > 0) this.log?.warn("pump.dropped", { count: dropped, code: "malformed" });
    return [...bySourceId.values()].sort(
      (a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.sourceId < b.sourceId ? -1 : 1),
    );
  }

  /** "ok" means the site answered `verifyauth` with read access (see `NightscoutSource.probe`). */
  probe(): Promise<ProbeResult> {
    return this.verifier.probe();
  }

  /** One allow-listed `GET treatments.json`; the transport refuses any other call before sending. */
  private async readPage(query: URLSearchParams, since: Date): Promise<Page> {
    // One signal for the request and the body: a stall anywhere ends as a timeout, not a hang.
    const signal = AbortSignal.timeout(this.timeoutMs);
    let status: number;
    let text: string;
    try {
      const response = await sendNightscoutRequest(this.fetch, {
        baseUrl: this.baseUrl,
        ...ENDPOINTS.treatments,
        auth: this.auth,
        signal,
        query,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      if (error instanceof ReadOnlyEndpointError) throw error;
      const code = signal.aborted ? "Timeout" : "Network";
      this.log?.warn("nightscout.unreachable", { code });
      throw new NightscoutError(code, 0);
    }
    if (status < 200 || status >= 300) {
      this.log?.warn("nightscout.request-failed", { code: String(status) });
      throw new NightscoutError(String(status), status);
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = undefined;
    }
    const list = TreatmentsResponse.safeParse(body);
    if (!list.success) {
      this.log?.warn("nightscout.request-failed", { code: "UnexpectedShape" });
      throw new NightscoutError("UnexpectedShape", status);
    }
    return toPage(list.data, since);
  }
}

/** A row of another treatment type is ignored, not dropped: the query should not have sent it. */
function isOtherType(row: unknown): boolean {
  if (typeof row !== "object" || row === null || !("eventType" in row)) return false;
  return row.eventType !== BOLUS_EVENT_TYPE;
}

function oldestOf(rows: readonly unknown[]): string | undefined {
  let oldest: string | undefined;
  for (const row of rows) {
    if (typeof row !== "object" || row === null || !("created_at" in row)) continue;
    const value = row.created_at;
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) continue;
    if (oldest === undefined || Date.parse(value) < Date.parse(oldest)) oldest = value;
  }
  return oldest;
}

/**
 * The mapping of plan §5: `ts` from `created_at` (UTC), the units as recorded (two decimals, as the
 * column holds them), the kind from `notes`, the calculator's carbs only when above zero.
 */
function toBolus(entry: TreatmentEntry): PumpBolus | undefined {
  const carbs =
    entry.carbs !== undefined && Number.isFinite(entry.carbs) && entry.carbs > 0
      ? Math.round(entry.carbs)
      : undefined;
  const parsed = PumpBolus.safeParse({
    sourceId: String(entry.pump_event_id),
    ts: new Date(Date.parse(entry.created_at)).toISOString(),
    units: Math.round(entry.insulin * 100) / 100,
    kind: toKind(entry.notes),
    ...(carbs === undefined ? {} : { carbs }),
  });
  return parsed.success ? parsed.data : undefined;
}

function toPage(rows: readonly unknown[], since: Date): Page {
  const boluses: PumpBolus[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (isOtherType(row)) continue;
    const entry = TreatmentEntry.safeParse(row);
    const bolus = entry.success ? toBolus(entry.data) : undefined;
    if (bolus === undefined) {
      dropped += 1;
      continue;
    }
    if (Date.parse(bolus.ts) >= since.getTime()) boluses.push(bolus);
  }
  return { rows: rows.length, oldest: oldestOf(rows), boluses, dropped };
}
