import type { InvocationContext, Timer } from "@azure/functions";
import {
  log as defaultLog,
  runPumpCycle,
  type Logger,
  type PumpCycleDeps,
  type PumpSpaceOutcome,
} from "@frejsi/shared";

/**
 * Second 0 of every fifteenth minute (v0.7.0 plan §5, decision 3): the pump record lags by up to
 * an hour, so every five minutes would be waste. Its own timer function, so a slow Nightscout
 * site never delays a glucose cycle.
 */
export const PUMP_SCHEDULE = "0 */15 * * * *";
/** A random wait before each cycle, as for the glucose poll, so no site sees every client at :00. */
export const PUMP_JITTER_MAX_MS = 20_000;

export function pumpJitterMs(random: () => number = Math.random): number {
  return Math.floor(random() * PUMP_JITTER_MAX_MS);
}

export interface PumpHandlerDeps {
  cycleDeps: Pick<PumpCycleDeps, "db" | "sources"> & Partial<Pick<PumpCycleDeps, "sink" | "now">>;
  runCycle?: typeof runPumpCycle;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Milliseconds for the summary's `ms`; tests pass a fixed one. */
  clock?: () => number;
  log?: Logger;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The `pump-poll` function's body: jitter, one pump cycle, and one `pump.cycle` line with the new
 * boluses as `count` and `ok` or how many spaces failed as `code`. Counts and codes only: the
 * cycle's own lines carry the space ids, and nothing carries an address, a token, units or carbs.
 */
export function createPumpHandler(deps: PumpHandlerDeps) {
  const runCycle = deps.runCycle ?? runPumpCycle;
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? defaultLog;

  return async (_timer: Timer, _context: InvocationContext): Promise<void> => {
    const started = clock();
    await sleep(pumpJitterMs(deps.random));
    const outcomes: PumpSpaceOutcome[] = await runCycle({ ...deps.cycleDeps, log });
    const stored = outcomes.reduce((sum, o) => sum + o.stored, 0);
    const failed = outcomes.filter((o) => o.outcome === "failed").length;
    const fields = {
      count: stored,
      code: failed === 0 ? "ok" : `${String(failed)}-failed`,
      ms: clock() - started,
    };
    if (failed === 0) log.info("pump.cycle", fields);
    else log.warn("pump.cycle", fields);
  };
}
