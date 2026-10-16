"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { Reading } from "@frejsi/shared/schemas/index";

import {
  LiveFeed,
  type FeedEventHandler,
  type FeedEventType,
  type LiveFeedOptions,
  type LiveFeedState,
} from "./live-feed";

const SERVER_SNAPSHOT: LiveFeedState = {
  loaded: false,
  connection: "connecting",
  lastSeq: 0,
  readings: [],
  latest: null,
  sourceStatus: "not-configured",
  sourceSince: null,
  space: null,
  error: null,
  events: [],
};

/** What `useLiveFeed` returns: the feed's state and a way to hear its events (plan §7). */
export type LiveFeedView = LiveFeedState & {
  /** Calls `handler` for every later event of `type`; returns the unsubscribe. */
  subscribe: <T extends FeedEventType>(type: T, handler: FeedEventHandler<T>) => () => void;
  /** Shows a reading this client stored itself, until its event arrives and replaces it. */
  addReading: (reading: Reading) => void;
};

/**
 * The live feed of one space (spec §3b): the readings window, then pushed events, with catch-up on
 * every (re)connect and 30-second polling while the socket is down. Screens read from this and
 * never fetch live data themselves. The server render sees the empty snapshot; nothing of glucose
 * is drawn until `loaded`. With `readings: false` (the viewer's day) it carries events only and
 * never asks for readings.
 */
export function useLiveFeed(
  spaceId: string,
  options: Omit<LiveFeedOptions, "spaceId"> = {},
): LiveFeedView {
  const { hours, fetch, socketFactory, now, pollMs, readings } = options;
  const feed = useMemo(
    () =>
      new LiveFeed({
        spaceId,
        ...(hours !== undefined ? { hours } : {}),
        ...(fetch ? { fetch } : {}),
        ...(socketFactory ? { socketFactory } : {}),
        ...(now ? { now } : {}),
        ...(pollMs !== undefined ? { pollMs } : {}),
        ...(readings !== undefined ? { readings } : {}),
      }),
    [spaceId, hours, fetch, socketFactory, now, pollMs, readings],
  );
  useEffect(() => {
    feed.start();
    if (typeof document === "undefined" || typeof window === "undefined") {
      return () => {
        feed.stop();
      };
    }
    // The phone wakes up, the tab comes back, the page is restored from the back-forward cache or
    // the network returns: the feed checks its socket and catches up (see `LiveFeed.resume`).
    const onVisibility = () => {
      if (document.visibilityState === "visible") feed.resume();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) feed.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", feed.resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", feed.resume);
      feed.stop();
    };
  }, [feed]);
  const state = useSyncExternalStore(feed.subscribe, feed.getState, () => SERVER_SNAPSHOT);
  return useMemo(
    () => ({ ...state, subscribe: feed.onEvent, addReading: feed.addReading }),
    [state, feed],
  );
}
