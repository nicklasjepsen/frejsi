import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  ConnectSourceRequest,
  DexcomShareSource,
  glucoseSecretName,
  log as defaultLog,
  serializeCredential,
  type ApiError,
  type ConnectSourceResult,
  type DexcomShareRegion,
  type GlucoseSource,
  type GlucoseSourceType,
  type Logger,
  type ProbeResult,
  type Secrets,
} from "@frejsi/shared";

export interface ProbeRequest {
  type: GlucoseSourceType;
  region: DexcomShareRegion;
  username: string;
  password: string;
}

export interface SourceConnectDeps {
  secrets: Secrets;
  /** Checks the credential against the source; defaults to the adapter the request's `type` names. */
  probe?: (request: ProbeRequest) => Promise<ProbeResult>;
  log?: Logger;
}

/** One adapter per `GlucoseSourceType`; a type added without an adapter fails to compile here. */
const ADAPTERS: Record<GlucoseSourceType, (request: ProbeRequest) => GlucoseSource> = {
  "dexcom-share": (request) => new DexcomShareSource(request),
};

/** The adapter the request's source type names. */
export function probeSourceFor(request: ProbeRequest): GlucoseSource {
  return ADAPTERS[request.type](request);
}

const defaultProbe = (request: ProbeRequest) => probeSourceFor(request).probe();

const validation = (): HttpResponseInit => {
  const body: ApiError = {
    error: { code: "validation", message: "The request is not a ConnectSourceRequest." },
  };
  return { status: 400, jsonBody: body };
};

/**
 * `POST /api/source-connect` (function key): the Settings route forwards the owner's Dexcom login,
 * this probes it and, when it works, writes it to Key Vault as `glucose-<spaceId>`. The credential
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
    const { spaceId, type, region, username, password } = parsed.data;

    let outcome: ProbeResult;
    try {
      outcome = await probe({ type, region, username, password });
    } catch {
      outcome = "unreachable";
    }
    if (outcome !== "ok") {
      log.warn("source-connect.failed", { spaceId, code: outcome });
      const result: ConnectSourceResult = { result: outcome };
      return { status: 200, jsonBody: result };
    }

    const secretRef = glucoseSecretName(spaceId);
    await deps.secrets.set(secretRef, serializeCredential({ username, password }));
    log.info("source-connect.ok", { spaceId, code: "ok" });
    const result: ConnectSourceResult = { result: "ok", secretRef };
    return { status: 200, jsonBody: result };
  };
}
