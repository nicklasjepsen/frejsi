import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  ConnectSourceRequest,
  DexcomShareSource,
  glucoseSecretName,
  log as defaultLog,
  NightscoutSource,
  serializeCredential,
  serializeNightscoutCredential,
  type ApiError,
  type ConnectSourceResult,
  type FetchLike,
  type GlucoseSource,
  type PolledSourceType,
  type Logger,
  type ProbeResult,
  type Secrets,
} from "@frejsi/shared";

/** What a probe needs: the connect request without its `spaceId`, for the types that are polled. */
export type ProbeRequest = DistributiveOmit<
  Exclude<ConnectSourceRequest, { type: "manual" }>,
  "spaceId"
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a probe found: the credential's verdict and, when it worked, how many readings the source
 * returned for the last day. Absent when that read failed; the credential is stored either way.
 */
export interface ProbeOutcome {
  result: ProbeResult;
  recentReadings?: number;
}

export interface SourceConnectDeps {
  secrets: Secrets;
  /**
   * Checks the credential and reads the last day; defaults to the adapter the request's `type`
   * names, with `fetch` and `now` below.
   */
  probe?: (request: ProbeRequest) => Promise<ProbeOutcome>;
  log?: Logger;
  /** What the default probe's adapter fetches with; for tests. */
  fetch?: FetchLike;
  now?: () => Date;
}

/** What the handler hands an adapter besides the credential: outcome logging, fetch and clock. */
export interface AdapterOptions {
  log?: Logger;
  fetch?: FetchLike;
  now?: () => Date;
}

/**
 * How far back the default probe reads once the login works: the poll's own first window. Zero
 * readings in a day with a working login is almost always a follower's login instead of the
 * sharer's, or sharing turned off; the form says so.
 */
export const RECENT_READINGS_WINDOW_MS = 24 * 60 * 60_000;

/** One adapter per `GlucoseSourceType`; a type added without an adapter fails to compile here. */
const ADAPTERS: {
  [T in PolledSourceType]: (
    request: Extract<ProbeRequest, { type: T }>,
    options: AdapterOptions,
  ) => GlucoseSource;
} = {
  "dexcom-share": (request, options) => new DexcomShareSource({ ...request, ...options }),
  nightscout: (request, options) =>
    new NightscoutSource({
      url: request.url,
      token: request.token,
      apiSecret: request.apiSecret,
      ...options,
    }),
};

/**
 * The adapter the request's source type names. The adapter logs its outcome codes through
 * `options.log` (`dexcom.probe-failed` with the service's own code, for one), never a credential.
 */
export function probeSourceFor(request: ProbeRequest, options: AdapterOptions = {}): GlucoseSource {
  // TypeScript cannot correlate the adapter with the request through the lookup; the mapped type
  // above is what makes a polled type without an adapter a compile error.
  const adapter = ADAPTERS[request.type] as (
    request: ProbeRequest,
    options: AdapterOptions,
  ) => GlucoseSource;
  return adapter(request, options);
}

/** The default probe: the adapter's `probe()`, then the last day's readings on the same session. */
export async function probeAndReadRecent(
  request: ProbeRequest,
  options: AdapterOptions,
): Promise<ProbeOutcome> {
  const source = probeSourceFor(request, options);
  const result = await source.probe();
  if (result !== "ok") return { result };
  const now = options.now ?? (() => new Date());
  try {
    const readings = await source.fetchSince(new Date(now().getTime() - RECENT_READINGS_WINDOW_MS));
    return { result, recentReadings: readings.length };
  } catch (error) {
    // The login worked; the read is what the form warns from. The adapter has logged the cause.
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    options.log?.warn("source-connect.recent-failed", { code });
    return { result };
  }
}

/** `deps` as adapter options, without the keys that are not set (exactOptionalPropertyTypes). */
function adapterOptions(deps: SourceConnectDeps, log: Logger): AdapterOptions {
  return {
    log,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}

/** The credential as it is stored under `glucose-<spaceId>`, per type. */
function serializeSecret(request: ProbeRequest): string {
  switch (request.type) {
    case "dexcom-share":
      return serializeCredential({ username: request.username, password: request.password });
    case "nightscout":
      return serializeNightscoutCredential({
        url: request.url,
        ...(request.token === undefined ? {} : { token: request.token }),
        ...(request.apiSecret === undefined ? {} : { apiSecret: request.apiSecret }),
      });
  }
}

const validation = (): HttpResponseInit => {
  const body: ApiError = {
    error: { code: "validation", message: "The request is not a ConnectSourceRequest." },
  };
  return { status: 400, jsonBody: body };
};

/**
 * `POST /api/source-connect` (function key): the Settings route forwards the owner's login,
 * this probes it and, when it works, writes it to Key Vault as `glucose-<spaceId>` (a Dexcom login or a Nightscout address with its token or secret). The credential
 * is in the request body and the secret value, and nowhere else: not in the database, not in a log.
 */
export function createSourceConnectHandler(deps: SourceConnectDeps) {
  const log = deps.log ?? defaultLog;
  const probe =
    deps.probe ??
    ((request: ProbeRequest) => probeAndReadRecent(request, adapterOptions(deps, log)));

  return async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      log.warn("source-connect.rejected", { code: "validation" });
      return validation();
    }
    const parsed = ConnectSourceRequest.safeParse(json);
    if (!parsed.success) {
      log.warn("source-connect.rejected", { code: "validation" });
      return validation();
    }
    const { data } = parsed;
    if (data.type === "manual") {
      // Choosing Manuelt writes no credential; the Settings route handles it itself.
      log.warn("source-connect.rejected", { code: "validation" });
      return validation();
    }
    const { spaceId, ...probeRequest } = data;

    let outcome: ProbeOutcome;
    try {
      outcome = await probe(probeRequest);
    } catch {
      outcome = { result: "unreachable" };
    }
    if (outcome.result !== "ok") {
      log.warn("source-connect.failed", { spaceId, code: outcome.result });
      const result: ConnectSourceResult = { result: outcome.result };
      return { status: 200, jsonBody: result };
    }

    const secretRef = glucoseSecretName(spaceId);
    await deps.secrets.set(secretRef, serializeSecret(probeRequest));
    const recent =
      outcome.recentReadings === undefined ? {} : { recentReadings: outcome.recentReadings };
    // `count` is the logger's key for it (the allow-list), as on the poll lines.
    log.info("source-connect.ok", {
      spaceId,
      code: "ok",
      ...(outcome.recentReadings === undefined ? {} : { count: outcome.recentReadings }),
    });
    // Its own line, so an alert can watch for it: the login works but nothing comes through.
    if (outcome.recentReadings === 0) log.warn("source-connect.no-recent-readings", { spaceId });
    const result: ConnectSourceResult = { result: "ok", secretRef, ...recent };
    return { status: 200, jsonBody: result };
  };
}
