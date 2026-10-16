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

export interface SourceConnectDeps {
  secrets: Secrets;
  /** Checks the credential against the source; defaults to the adapter the request's `type` names. */
  probe?: (request: ProbeRequest) => Promise<ProbeResult>;
  log?: Logger;
}

/** One adapter per `GlucoseSourceType`; a type added without an adapter fails to compile here. */
const ADAPTERS: {
  [T in PolledSourceType]: (request: Extract<ProbeRequest, { type: T }>) => GlucoseSource;
} = {
  "dexcom-share": (request) => new DexcomShareSource(request),
  nightscout: (request) =>
    new NightscoutSource({
      url: request.url,
      token: request.token,
      apiSecret: request.apiSecret,
    }),
};

/** The adapter the request's source type names. */
export function probeSourceFor(request: ProbeRequest): GlucoseSource {
  // TypeScript cannot correlate the adapter with the request through the lookup; the mapped type
  // above is what makes a polled type without an adapter a compile error.
  const adapter = ADAPTERS[request.type] as (request: ProbeRequest) => GlucoseSource;
  return adapter(request);
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

const defaultProbe = (request: ProbeRequest) => probeSourceFor(request).probe();

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
  const probe = deps.probe ?? defaultProbe;
  const log = deps.log ?? defaultLog;

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

    let outcome: ProbeResult;
    try {
      outcome = await probe(probeRequest);
    } catch {
      outcome = "unreachable";
    }
    if (outcome !== "ok") {
      log.warn("source-connect.failed", { spaceId, code: outcome });
      const result: ConnectSourceResult = { result: outcome };
      return { status: 200, jsonBody: result };
    }

    const secretRef = glucoseSecretName(spaceId);
    await deps.secrets.set(secretRef, serializeSecret(probeRequest));
    log.info("source-connect.ok", { spaceId, code: "ok" });
    const result: ConnectSourceResult = { result: "ok", secretRef };
    return { status: 200, jsonBody: result };
  };
}
