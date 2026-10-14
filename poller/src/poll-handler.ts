import type { InvocationContext, Timer } from "@azure/functions";
import {
  log as defaultLog,
  runPollCycle,
  trackEvent,
  type Logger,
  type PollCycleDeps,
  type SpaceOutcome,
} from "@frejsi/shared";

/** Second 0 of every fifth minute (spec §3). */
export const SCHEDULE = "0 */5 * * * *";
/** A random wait before each cycle so the Share service does not see every client at :00 (spec §3). */
export const JITTER_MAX_MS = 20_000;

export function jitterMs(random: () => number = Math.random): number {
  return Math.floor(random() * JITTER_MAX_MS);
}

export interface PollHandlerDeps {
  cycleDeps: Pick<PollCycleDeps, "db" | "sources" | "emit">;
  runCycle?: typeof runPollCycle;
  track?: typeof trackEvent;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Logger;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The timer function's body: jitter, one cycle, a `reading.stored` custom event per new reading
 * (the Bicep alert watches it, plan decision 21) and a one-line summary with counts and codes.
 */
export function createPollHandler(deps: PollHandlerDeps) {
  const runCycle = deps.runCycle ?? runPollCycle;
  const track = deps.track ?? trackEvent;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? defaultLog;

  return async (_timer: Timer, _context: InvocationContext): Promise<void> => {
    const started = Date.now();
    await sleep(jitterMs(deps.random));
    const outcomes: SpaceOutcome[] = await runCycle({
      ...deps.cycleDeps,
      log,
      onReadingStored: (spaceId) => {
        track("reading.stored", { spaceId });
      },
    });
    const stored = outcomes.reduce((sum, o) => sum + o.stored, 0);
    const failed = outcomes.filter((o) => o.outcome === "failed").length;
    const fields = {
      count: stored,
      code: failed === 0 ? "ok" : `${failed}-failed`,
      ms: Date.now() - started,
    };
    if (failed === 0) log.info("poll.cycle", fields);
    else log.warn("poll.cycle", fields);
  };
}
