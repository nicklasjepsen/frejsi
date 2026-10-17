import { randomUUID } from "node:crypto";
import type { SharedRecipe } from "./contracts";

/** Ten minutes: long enough to sign in and open the form, short enough to be forgotten (decision 11). */
export const SHARE_TTL_MS = 10 * 60 * 1000;
/** A bound on the process memory a burst of shares may take. The oldest goes first. */
export const SHARE_LIMIT = 200;

interface Entry {
  sessionId: string;
  share: SharedRecipe;
  expiresAt: number;
}

/**
 * The Web Share Target receiver's memory (plan §6, decision 11): one web instance, a share kept
 * ten minutes under a random id bound to the session that posted it, handed out once. A lost
 * share is a retry from the sharing app, never data loss; nothing here is written anywhere.
 */
export class ShareStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  put(sessionId: string, share: SharedRecipe): string {
    this.sweep();
    while (this.entries.size >= SHARE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const id = randomUUID();
    this.entries.set(id, { sessionId, share, expiresAt: this.now() + SHARE_TTL_MS });
    return id;
  }
  /** The share once: a second take, another session or an expired entry gets null. */
  take(id: string, sessionId: string): SharedRecipe | null {
    this.sweep();
    const entry = this.entries.get(id);
    if (entry?.sessionId !== sessionId) return null;
    this.entries.delete(id);
    return entry.share;
  }
  get size(): number {
    this.sweep();
    return this.entries.size;
  }
  private sweep(): void {
    const at = this.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= at) this.entries.delete(id);
  }
}

// One store per web process; survives the dev server's module reloads through globalThis.
const key = Symbol.for("frejsi.recipes.share-store");
const holder = globalThis as unknown as Record<symbol, ShareStore | undefined>;
export function shareStore(): ShareStore {
  return (holder[key] ??= new ShareStore());
}
