import {
  DexcomShareSource,
  log as defaultLog,
  NightscoutSource,
  parseCredential,
  parseNightscoutCredential,
  type FetchLike,
  type GlucoseSource,
  type Logger,
  type PolledSourceConfig,
  type PollSpaceRow,
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
 * config's `type` picks the adapter. One Dexcom instance per space lives for the process so the
 * session is reused across cycles; a changed credential or region replaces it, which logs in
 * afresh. A Nightscout source holds no session, so it is built from the secret on each call.
 * With `FAKE_GLUCOSE_SOURCE=1` every space gets `FakeGlucoseSource` and no secret is read.
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
