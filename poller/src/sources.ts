import {
  DexcomShareSource,
  log as defaultLog,
  NightscoutPumpSource,
  NightscoutSource,
  parseCredential,
  parseNightscoutCredential,
  type FetchLike,
  type GlucoseSource,
  type Logger,
  type PolledSourceConfig,
  type PollSpaceRow,
  type PumpSourceConfig,
  type PumpSourceFactory,
  type PumpSpaceRow,
  type Secrets,
  type SourceFactory,
} from "@frejsi/shared";
import { FakeGlucoseSource } from "@frejsi/shared/glucose/fake";

export interface SourceFactoryOptions {
  /** Or a function that builds it on the first read, so the fake never needs Key Vault configured. */
  secrets: Secrets | (() => Secrets);
  /** Defaults to `process.env`; `FAKE_GLUCOSE_SOURCE=1` gives every space the fake. */
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  log?: Logger;
  now?: () => Date;
}

/** Thrown when a space's secret is absent or not a credential; the cycle counts it as a failure. */
export class SourceSecretError extends Error {
  constructor(readonly code: "secret-missing" | "secret-invalid") {
    super(code);
    this.name = "SourceSecretError";
  }
}

interface Cached {
  key: string;
  source: GlucoseSource;
}

/**
 * The production source factory: the credential comes from Key Vault by `secretRef` and the
 * config's `type` picks the adapter. The reference names one version of the secret
 * (`glucose-<spaceId>/<version>`, what `source-connect` answered and the Settings route saved), so
 * the poller reads the credential that was committed with this config and never a newer one that
 * no config refers to yet (#78); a reference without a version, from before v0.5.4, reads the
 * latest. One Dexcom instance per space lives for the process so the session is reused across
 * cycles; a changed credential or region replaces it, which logs in afresh. A Nightscout source
 * holds no session, so it is built from the secret on each call. With `FAKE_GLUCOSE_SOURCE=1`
 * every space gets `FakeGlucoseSource` and no secret is read.
 */
export function createSourceFactory(options: SourceFactoryOptions): SourceFactory {
  let secrets: Secrets | undefined;
  const cache = new Map<string, Cached>();
  const log = options.log ?? defaultLog;
  const env = options.env ?? process.env;
  const fake = env.FAKE_GLUCOSE_SOURCE === "1" ? new FakeGlucoseSource() : undefined;
  const common = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  };

  const read = async (space: PollSpaceRow, config: PolledSourceConfig): Promise<string> => {
    secrets ??= typeof options.secrets === "function" ? options.secrets() : options.secrets;
    const raw = await secrets.get(config.secretRef);
    if (raw === undefined) {
      log.warn("source.secret-missing", { spaceId: space.id, code: "secret-missing" });
      throw new SourceSecretError("secret-missing");
    }
    return raw;
  };
  const invalid = (space: PollSpaceRow): SourceSecretError => {
    log.warn("source.secret-invalid", { spaceId: space.id, code: "secret-invalid" });
    return new SourceSecretError("secret-invalid");
  };

  return async (space: PollSpaceRow, config: PolledSourceConfig): Promise<GlucoseSource> => {
    if (fake) return fake;
    const raw = await read(space, config);

    if (config.type === "nightscout") {
      let credential;
      try {
        credential = parseNightscoutCredential(raw);
      } catch {
        throw invalid(space);
      }
      return new NightscoutSource({ ...credential, log, ...common });
    }

    let credential;
    try {
      credential = parseCredential(raw);
    } catch {
      throw invalid(space);
    }
    // The key never leaves this closure; it only tells a changed credential from an unchanged one.
    const key = JSON.stringify([config.region, credential.username, credential.password]);
    const cached = cache.get(space.id);
    if (cached?.key === key) return cached.source;

    const source = new DexcomShareSource({
      region: config.region,
      username: credential.username,
      password: credential.password,
      log,
      ...common,
    });
    cache.set(space.id, { key, source });
    return source;
  };
}

export interface PumpSourceFactoryOptions {
  /** Or a function that builds it on the first read, so a cycle without pump spaces needs no vault. */
  secrets: Secrets | (() => Secrets);
  fetch?: FetchLike;
  log?: Logger;
  now?: () => Date;
}

/**
 * The pump record's factory (v0.7.0 plan §5): the credential comes from Key Vault by the space's
 * versioned `pump-<spaceId>/<version>` reference, the one `source-connect` answered for a pump
 * connect, and becomes a `NightscoutPumpSource` on the allow-listed transport. That is the only
 * source it builds: the config's `type` is `nightscout` and nothing else. No session is kept, so
 * it is built from the secret on each cycle. A missing or unreadable secret throws, which the
 * cycle counts as one failure of that space.
 */
export function createPumpSourceFactory(options: PumpSourceFactoryOptions): PumpSourceFactory {
  let secrets: Secrets | undefined;
  const log = options.log ?? defaultLog;
  const common = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  return async (space: PumpSpaceRow, config: PumpSourceConfig) => {
    secrets ??= typeof options.secrets === "function" ? options.secrets() : options.secrets;
    const raw = await secrets.get(config.secretRef);
    if (raw === undefined) {
      log.warn("pump.secret-missing", { spaceId: space.id, code: "secret-missing" });
      throw new SourceSecretError("secret-missing");
    }
    let credential;
    try {
      credential = parseNightscoutCredential(raw);
    } catch {
      log.warn("pump.secret-invalid", { spaceId: space.id, code: "secret-invalid" });
      throw new SourceSecretError("secret-invalid");
    }
    return new NightscoutPumpSource({ ...credential, log, ...common });
  };
}
