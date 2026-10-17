import { formatSecretRef, parseSecretRef, type Secrets } from "./types";

interface Versions {
  latest: string;
  values: Map<string, string>;
}

/**
 * In-memory secrets. Tests, the seed and the CLI only (lint boundary). Versions count up from 1
 * per instance, so a test can name the reference it expects; `initial` seeds each name's first
 * version, which a plain name then reads as the latest.
 */
export class MemorySecrets implements Secrets {
  private readonly store = new Map<string, Versions>();
  private counter = 0;

  constructor(initial: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initial)) this.write(name, value);
  }

  // Both are async so a malformed reference rejects, as it does with the other stores.
  // eslint-disable-next-line @typescript-eslint/require-await
  async get(ref: string): Promise<string | undefined> {
    const { name, version } = parseSecretRef(ref);
    const secret = this.store.get(name);
    return secret?.values.get(version ?? secret.latest);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set(name: string, value: string): Promise<string> {
    return this.write(name, value);
  }

  private write(name: string, value: string): string {
    const version = String(++this.counter);
    const ref = formatSecretRef(name, version);
    const secret = this.store.get(name) ?? { latest: version, values: new Map() };
    secret.values.set(version, value);
    secret.latest = version;
    this.store.set(name, secret);
    return ref;
  }
}
