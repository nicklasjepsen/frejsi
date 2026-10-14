import type { Secrets } from "./types";

/** In-memory secrets. Tests, the seed and the CLI only (lint boundary). */
export class MemorySecrets implements Secrets {
  private readonly store: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  get(name: string): Promise<string | undefined> {
    return Promise.resolve(this.store.get(name));
  }

  set(name: string, value: string): Promise<void> {
    this.store.set(name, value);
    return Promise.resolve();
  }
}
