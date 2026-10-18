"use client";

import type { Role } from "@frejsi/shared/schemas/index";
import type { PumpBolusView, PumpHistoryView } from "@frejsi/shared/schemas/pump";
import { useCallback, useEffect, useState } from "react";

import type { FeedEventType } from "@/lib/live/live-feed";

import { loadPumpHistory } from "./api";

/** `off` for a viewer, a simpleMode session or a screen that is not ready: nothing was asked. */
export type PumpHistoryState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      boluses: PumpBolusView[];
      reach?: string;
      pumpStatus: PumpHistoryView["status"];
    };

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

/** The events after which the window is read again (v0.7.0 plan §6). Both are glucose-group only. */
export const PUMP_REFRESH_ON: FeedEventType[] = ["pump.imported", "pump.meals"];

/**
 * How long after a failed read the window is read again. Pump events come only when the poller
 * stores records, so without this a blip would leave the curve bare for hours, which reads as "no
 * bolus". Same cadence as the screens' own day recheck.
 */
export const PUMP_RECHECK_MS = 30_000;

export interface PumpHistoryOptions {
  subscribe: Subscribe | undefined;
  role: Role;
  simpleMode: boolean;
  /** The screen's own readiness (its feed loaded); false holds the read back. */
  enabled?: boolean;
}

/**
 * The pump record for a curve's window: read once per window and again on `pump.imported` and
 * `pump.meals` from the screen's live feed. For a viewer and a simpleMode session it asks for
 * nothing and subscribes to nothing; the route refuses both anyway, and that refusal is the guard.
 * A failed read is tried again every `PUMP_RECHECK_MS` until one succeeds; a failed refresh keeps
 * the window's boluses already drawn rather than wiping them.
 */
export function usePumpHistory(
  spaceId: string,
  from: string,
  to: string,
  { subscribe, role, simpleMode, enabled = true }: PumpHistoryOptions,
): PumpHistoryState {
  const allowed = enabled && role !== "viewer" && !simpleMode;
  const key = `${spaceId}:${from}:${to}`;
  const [state, setState] = useState<{ key: string; state: PumpHistoryState; retry: boolean }>({
    key: "",
    state: { status: "loading" },
    retry: false,
  });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    loadPumpHistory(spaceId, from, to, controller.signal)
      .then((view) => {
        setState({
          key,
          state: {
            status: "ready",
            boluses: view.boluses,
            ...(view.reach !== undefined ? { reach: view.reach } : {}),
            pumpStatus: view.status,
          },
          retry: false,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Only this window's own last answer may stay on screen; never another window's.
        setState((prev) =>
          prev.key === key && prev.state.status === "ready"
            ? { ...prev, retry: true }
            : { key, state: { status: "failed" }, retry: true },
        );
      });
    return () => {
      controller.abort();
    };
  }, [allowed, spaceId, from, to, key, version]);

  const retry = allowed && state.key === key && state.retry;
  useEffect(() => {
    if (!retry) return;
    const timer = setTimeout(refresh, PUMP_RECHECK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [retry, version, refresh]);

  useEffect(() => {
    if (!allowed || !subscribe) return;
    const offs = PUMP_REFRESH_ON.map((type) => subscribe(type, refresh));
    return () => {
      for (const off of offs) off();
    };
  }, [allowed, subscribe, refresh]);

  if (!allowed) return { status: "off" };
  return state.key === key ? state.state : { status: "loading" };
}
