"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

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
    return () => {
      feed.stop();
    };
  }, [feed]);
  const state = useSyncExternalStore(feed.subscribe, feed.getState, () => SERVER_SNAPSHOT);
  return useMemo(() => ({ ...state, subscribe: feed.onEvent }), [state, feed]);
}
