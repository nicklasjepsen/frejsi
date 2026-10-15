import { useState } from "react";

/**
 * State derived from a server component's props, with local writes layered on top. After a
 * `router.refresh()` the page arrives again with a new `source` object, and whatever this screen
 * had written is read back from the server with it, so the local layer is dropped and the fresh
 * props win: another owner's change made in the meantime is seen, not overwritten. No effect, no
 * flash of stale state; the comparison is by identity, which is what a refresh changes.
 */
export function useServerState<S, T>(
  source: S,
  derive: (source: S) => T,
): [T, (update: (current: T) => T) => void] {
  const [local, setLocal] = useState<{ from: S; value: T } | null>(null);
  const value = local !== null && local.from === source ? local.value : derive(source);
  const update = (fn: (current: T) => T) => {
    setLocal((previous) => {
      const base = previous !== null && previous.from === source ? previous.value : derive(source);
      return { from: source, value: fn(base) };
    });
  };
  return [value, update];
}
