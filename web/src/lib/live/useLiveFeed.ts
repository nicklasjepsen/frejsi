"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { LiveFeed, type LiveFeedOptions, type LiveState } from "./live-feed";

const SERVER_SNAPSHOT: LiveState = {
  loaded: false,
  connection: "connecting",
  lastSeq: 0,
  readings: [],
  latest: null,
  sourceStatus: "not-configured",
  sourceSince: null,
  space: null,
  error: null,
};

/**
 * The live feed of one space (spec §3b): the readings window, then pushed events, with catch-up on
 * every (re)connect and 30-second polling while the socket is down. Screens read from this and
 * never fetch live data themselves. The server render sees the empty snapshot; nothing of glucose
 * is drawn until `loaded`.
 */
export function useLiveFeed(
  spaceId: string,
  options: Omit<LiveFeedOptions, "spaceId"> = {},
): LiveState {
  const { hours, fetch, socketFactory, now, pollMs } = options;
  const feed = useMemo(
    () =>
      new LiveFeed({
        spaceId,
        ...(hours !== undefined ? { hours } : {}),
        ...(fetch ? { fetch } : {}),
        ...(socketFactory ? { socketFactory } : {}),
        ...(now ? { now } : {}),
        ...(pollMs !== undefined ? { pollMs } : {}),
      }),
    [spaceId, hours, fetch, socketFactory, now, pollMs],
  );
  useEffect(() => {
    feed.start();
    return () => {
      feed.stop();
    };
  }, [feed]);
  return useSyncExternalStore(feed.subscribe, feed.getState, () => SERVER_SNAPSHOT);
}
