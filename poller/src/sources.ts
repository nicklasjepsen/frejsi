import {
  DexcomShareSource,
  log as defaultLog,
  parseCredential,
  type FetchLike,
  type GlucoseSource,
  type GlucoseSourceConfig,
  type Logger,
  type PollSpaceRow,
  type Secrets,
  type SourceFactory,
} from "@frejsi/shared";

export interface DexcomSourceFactoryOptions {
  secrets: Secrets;
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
 * The production source factory: the credential comes from Key Vault by `secretRef`, and one
 * adapter instance per space lives for the process so the Dexcom session is reused across cycles.
 * A changed credential or region replaces the instance, which logs in afresh.
 */
export function createDexcomSourceFactory(options: DexcomSourceFactoryOptions): SourceFactory {
  const cache = new Map<string, Cached>();
  const log = options.log ?? defaultLog;

  return async (space: PollSpaceRow, config: GlucoseSourceConfig): Promise<GlucoseSource> => {
    const raw = await options.secrets.get(config.secretRef);
    if (raw === undefined) {
      log.warn("source.secret-missing", { spaceId: space.id, code: "secret-missing" });
      throw new SourceSecretError("secret-missing");
    }
    let credential;
    try {
      credential = parseCredential(raw);
    } catch {
      log.warn("source.secret-invalid", { spaceId: space.id, code: "secret-invalid" });
      throw new SourceSecretError("secret-invalid");
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
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    cache.set(space.id, { key, source });
    return source;
  };
}
