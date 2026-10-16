// The client side of the live feed, without React: `LiveFeed` negotiates, connects, catches up
// and polls (plan §5); `useLiveFeed` wraps it. Framework-free so the whole protocol is tested with
// a fake socket and fake timers.
import {
  EventEnvelope,
  type ApiErrorCode,
  type EventEnvelopeOf,
  type EventType,
  type Reading,
  type SourceStatus,
} from "@frejsi/shared/schemas/index";

import {
  CURSOR_ONLY_SINCE,
  DEFAULT_WINDOW_HOURS,
  EventsPage,
  type LiveSpace,
  NegotiateResult,
  ReadingsWindow,
} from "./contracts";

/** How often the feed asks for events while the socket is not live (spec §3b). */
export const POLL_MS = 30_000;
/** How many of the latest non-reading events `LiveFeedState.events` keeps. */
export const MAX_EVENTS = 100;
/** `visibilitychange`, `pageshow` and `online` fire together on a wake-up: one resume per burst. */
export const RESUME_DEBOUNCE_MS = 1_000;

/** Every event type but `reading`: the ones `events` and `onEvent` carry. */
export type FeedEventType = Exclude<EventType, "reading">;
export type FeedEventHandler<T extends FeedEventType> = (envelope: EventEnvelopeOf<T>) => void;

/** The slice of `WebSocket` the feed uses; tests pass a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

/**
 * `connecting` until the first socket opens or the first negotiate fails; `live` while the socket
 * is open; `polling` while events come from `events?since` every 30 s instead.
 */
export type Connection = "connecting" | "live" | "polling";

export interface LiveState {
  /** True once the readings window has been loaded; the screen shows nothing of glucose before. */
  loaded: boolean;
  connection: Connection;
  lastSeq: number;
  /** Oldest first, each with its `ts`; only the window's hours are kept. */
  readings: Reading[];
  /** The newest reading whatever its age, so a long outage still shows the last value and its age. */
  latest: Reading | null;
  sourceStatus: SourceStatus;
  sourceSince: string | null;
  space: LiveSpace | null;
  /**
   * A refusal (403 for a viewer, 404 for a non-member) of the window, a catch-up or a negotiate;
   * the feed stops and drops every reading it held.
   */
  error: ApiErrorCode | null;
}

/** `LiveState` plus the events the feed has seen; kept apart so v0.1.0's `LiveState` is unchanged. */
export interface LiveFeedState extends LiveState {
  /**
   * The non-reading events received since `start()`, oldest first, the last `MAX_EVENTS` of them
   * (plan §7): pushed or caught up, in sequence order. A screen that refetches on an event uses
   * `onEvent` instead of watching this list.
   */
  events: EventEnvelope[];
}

export interface LiveFeedOptions {
  spaceId: string;
  /** The readings window, 1..24 hours; the day curve needs 24. */
  hours?: number;
  fetch?: typeof fetch;
  socketFactory?: SocketFactory;
  now?: () => Date;
  pollMs?: number;
  /**
   * False for a feed without glucose (the viewer's day): no readings window is ever asked for; the
   * cursor comes from `events` and the feed carries events only. True by default.
   */
  readings?: boolean;
}

const INITIAL: LiveFeedState = {
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

/** The browser's WebSocket behind `SocketLike`; the feed only ever assigns the handlers. */
const defaultSocketFactory: SocketFactory = (url) => {
  const ws = new WebSocket(url);
  const like: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close: () => {
      ws.close();
    },
  };
  ws.onopen = () => like.onopen?.();
  ws.onmessage = (event) => like.onmessage?.({ data: event.data as unknown });
  ws.onclose = () => like.onclose?.();
  ws.onerror = () => like.onerror?.();
  return like;
};

export class LiveFeed {
  private state: LiveFeedState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly spaceId: string;
  private readonly hours: number;
  private readonly fetchImpl: typeof fetch;
  private readonly socketFactory: SocketFactory;
  private readonly now: () => Date;
  private readonly pollMs: number;
  private readonly withReadings: boolean;
  private readonly handlers = new Map<FeedEventType, Set<(envelope: EventEnvelope) => void>>();
  private socket: SocketLike | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  /** Bumped by every `start()` and `stop()`: async work from an earlier life bails out. */
  private generation = 0;
  /** The negotiate request in flight, if any. */
  private negotiation: AbortController | null = null;
  /** A window reload (`space.updated`) that has not succeeded yet; the tick retries it. */
  private windowStale = false;
  /** The readings request in flight; a newer load or `stop()` abandons it. */
  private windowRequest: AbortController | null = null;
  /** A catch-up that failed; the tick retries it, even while the socket is live. */
  private catchUpFailed = false;
  /** The catch-up in flight, if any; one at a time. */
  private catchUpRequest: AbortController | null = null;
  /** True once a tick has seen the current catch-up still out. */
  private catchUpOutlivedTick = false;
  private catchUpAgain = false;
  /** When the socket last opened or delivered a message; a longer silence than `pollMs` is suspect. */
  private lastMessageAt = 0;
  /** Messages received over the socket since `start()`; tells a catch-up's events from pushed ones. */
  private messageCount = 0;
  private lastResumeAt = 0;

  constructor(options: LiveFeedOptions) {
    this.spaceId = options.spaceId;
    this.hours = options.hours ?? DEFAULT_WINDOW_HOURS;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date());
    this.pollMs = options.pollMs ?? POLL_MS;
    this.withReadings = options.readings ?? true;
  }

  getState = (): LiveFeedState => this.state;

  /**
   * A reading this client just stored itself (a finger-prick): shown at once, keyed by `ts` like
   * a pushed one, so the `reading` event that follows replaces it and the count does not grow.
   */
  addReading = (reading: Reading): void => {
    this.putReading(reading);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Calls `handler` with every event of `type` the feed applies from now on, pushed or caught up;
   * returns the unsubscribe. A handler that throws is skipped, never the feed (plan §7).
   */
  onEvent = <T extends FeedEventType>(type: T, handler: FeedEventHandler<T>): (() => void) => {
    const wrapped = handler as (envelope: EventEnvelope) => void;
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(wrapped);
    return () => {
      this.handlers.get(type)?.delete(wrapped);
    };
  };

  /** Loads the window, then negotiates and connects. Idempotent while running. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    void this.loadWindow(this.generation);
  }

  /**
   * Closes the socket, clears the timer and invalidates every request in flight; `start()` begins
   * again from the window. React strict mode runs start–stop–start before the first request
   * answers, and only the last life may open a socket.
   */
  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.abandonNegotiation();
    this.windowRequest?.abort();
    this.windowRequest = null;
    this.abandonCatchUp();
    this.stopPolling();
    this.discardSocket();
    if (this.state.connection === "live") this.set({ connection: "polling" });
  }

  /**
   * The page is in the foreground again (`visibilitychange` to visible, `pageshow`, `online`). iOS
   * kills a background socket and pauses timers without a prompt `close`, so a stale value could
   * sit under a "live" badge until the dead socket is noticed: catch up at once, restart the poll
   * timer, and verify the socket. One that has been silent for longer than the poll interval, or
   * that the catch-up shows missed events, is dropped and a new one negotiated. A burst of resume
   * events within a second counts as one; nothing happens before `start()` or after `stop()`.
   */
  resume = (): void => {
    if (this.stopped) return;
    const gen = this.generation;
    const at = this.now().getTime();
    if (at - this.lastResumeAt < RESUME_DEBOUNCE_MS) return;
    this.lastResumeAt = at;
    if (this.pollTimer) {
      // A paused interval fires whenever the browser gets round to it: start it afresh from now.
      this.stopPolling();
      this.ensureTimer();
    }
    if (!this.state.loaded || this.windowStale) {
      // The request that was out when the phone slept may never answer: ask again.
      void this.loadWindow(gen);
      return;
    }
    const liveSocket = this.state.connection === "live" ? this.socket : null;
    if (liveSocket && at - this.lastMessageAt > this.pollMs) {
      this.discardSocket();
      this.startPolling();
      this.abandonCatchUp();
      void this.catchUp(gen);
      this.connect(gen);
      return;
    }
    // A handshake the sleep interrupted never finishes: a new socket after the catch-up.
    if (!liveSocket && this.socket) this.discardSocket();
    void this.verify(gen, liveSocket);
  };

  /**
   * A fresh catch-up, with a reconnect alongside when no socket is live. A live socket that
   * delivered none of the events the catch-up found has lost its group or its connection: replaced.
   */
  private async verify(gen: number, socket: SocketLike | null): Promise<void> {
    const messages = this.messageCount;
    const before = this.state.lastSeq;
    this.abandonCatchUp();
    const catchingUp = this.catchUp(gen);
    if (!socket) this.connect(gen);
    await catchingUp;
    if (this.cancelled(gen) || !socket || this.socket !== socket) return;
    if (this.messageCount === messages && this.state.lastSeq > before) this.reconnect(gen);
  }

  /** Drops the socket, polls meanwhile, and negotiates a new one. */
  private reconnect(gen: number): void {
    this.discardSocket();
    this.startPolling();
    this.connect(gen);
  }

  /** True when `gen` is not the running life: its result is thrown away. */
  private cancelled(gen: number): boolean {
    return this.stopped || gen !== this.generation;
  }

  private set(patch: Partial<LiveFeedState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private url(path: string, query: Record<string, string> = {}): string {
    const params = new URLSearchParams(query).toString();
    return `/api/spaces/${this.spaceId}/${path}${params ? `?${params}` : ""}`;
  }

  /**
   * `readings?hours=`: the window and the cursor it is consistent with, then `connect()`. A refusal
   * stops the feed; anything else is retried on the poll timer. On a reload (`space.updated`) a
   * message may already have moved the cursor past the window's: the stretch between is fetched
   * again so nothing received meanwhile is lost.
   */
  private async loadWindow(gen: number): Promise<void> {
    if (!this.withReadings) {
      await this.loadCursor(gen);
      return;
    }
    // A request that never answers would leave the screen loading: the timer runs while it is out,
    // and the next tick abandons it and asks again.
    this.windowRequest?.abort();
    const controller = new AbortController();
    this.windowRequest = controller;
    this.ensureTimer();
    const superseded = () => this.cancelled(gen) || this.windowRequest !== controller;
    let body: unknown = null;
    try {
      const response = await this.fetchImpl(this.url("readings", { hours: String(this.hours) }), {
        signal: controller.signal,
      });
      if (superseded()) return;
      if (this.refused(response)) return;
      if (response.ok) body = await response.json();
    } catch {
      body = null;
    }
    if (superseded()) return;
    this.windowRequest = null;
    const parsed = body === null ? null : ReadingsWindow.safeParse(body);
    if (!parsed?.success) {
      // Retried on the timer: as the first load, or as a stale window while the socket stays up.
      this.windowStale = true;
      if (this.state.connection !== "live") this.startPolling();
      else this.ensureTimer();
      return;
    }
    const window = parsed.data;
    const before = this.state;
    this.windowStale = false;
    this.set({
      loaded: true,
      error: null,
      lastSeq: window.lastSeq,
      readings: this.prune(window.readings),
      latest: newest(window.latest, before.loaded ? before.latest : null),
      sourceStatus: window.sourceStatus,
      sourceSince: window.sourceSince,
      space: window.space,
    });
    if (before.loaded && before.lastSeq > window.lastSeq) void this.catchUp(gen);
    if (this.state.connection === "live") this.settleTimer();
    else this.connect(gen);
  }

  /**
   * The feed without readings: `events?since=CURSOR_ONLY_SINCE` answers the space's current
   * sequence and nothing else, which is where this feed starts, then `connect()`. Retried on the
   * timer like the window; a refusal stops the feed.
   */
  private async loadCursor(gen: number): Promise<void> {
    this.windowRequest?.abort();
    const controller = new AbortController();
    this.windowRequest = controller;
    this.ensureTimer();
    const superseded = () => this.cancelled(gen) || this.windowRequest !== controller;
    let body: unknown = null;
    try {
      const response = await this.fetchImpl(
        this.url("events", { since: String(CURSOR_ONLY_SINCE) }),
        { signal: controller.signal },
      );
      if (superseded()) return;
      if (this.refused(response)) return;
      if (response.ok) body = await response.json();
    } catch {
      body = null;
    }
    if (superseded()) return;
    this.windowRequest = null;
    const parsed = body === null ? null : EventsPage.safeParse(body);
    if (!parsed?.success) {
      this.windowStale = true;
      this.startPolling();
      return;
    }
    this.windowStale = false;
    this.set({ loaded: true, error: null, lastSeq: parsed.data.lastSeq });
    this.connect(gen);
  }

  /**
   * Negotiates a token and opens the socket; one attempt at a time. Without a token (503, offline)
   * the feed polls instead. The poll timer runs from before the request until the socket has
   * actually opened, so a negotiate or a handshake that never finishes still leaves the screen fed
   * over HTTP; the next tick abandons the hung attempt and tries again.
   */
  private connect(gen: number): void {
    if (this.cancelled(gen) || this.socket || this.negotiation) return;
    this.ensureTimer();
    const controller = new AbortController();
    this.negotiation = controller;
    void this.fetchImpl(this.url("negotiate"), { signal: controller.signal })
      .then(async (response) => {
        if (this.cancelled(gen) || this.negotiation !== controller) return null;
        if (this.refused(response)) return null;
        return response.ok ? NegotiateResult.safeParse(await response.json()) : null;
      })
      .catch(() => null)
      .then((parsed) => {
        if (this.cancelled(gen) || this.negotiation !== controller) return;
        this.negotiation = null;
        if (!parsed?.success) {
          this.startPolling();
          return;
        }
        this.open(parsed.data.url, gen);
      });
  }

  /** Gives up on a negotiate still in flight; its answer, if it ever comes, is ignored. */
  private abandonNegotiation(): void {
    this.negotiation?.abort();
    this.negotiation = null;
  }

  private open(url: string, gen: number): void {
    const socket = this.socketFactory(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || this.cancelled(gen)) return;
      this.lastMessageAt = this.now().getTime();
      // A window reload that failed before the socket opened is retried only by the timer.
      this.set({ connection: "live" });
      this.settleTimer();
      void this.catchUp(gen);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.cancelled(gen)) return;
      this.lastMessageAt = this.now().getTime();
      this.messageCount += 1;
      this.receive(event.data, gen);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.cancelled(gen)) return;
      this.startPolling();
      void this.catchUp(gen);
    };
    socket.onerror = () => {
      // `close` follows an error; nothing to do here.
    };
  }

  /** Drops the current socket without hearing its `close`. */
  private discardSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }

  /**
   * One tick: reload the window if it never loaded or a reload failed; otherwise, while not live,
   * fetch events, drop a socket whose handshake or a negotiate that has not finished since the last
   * tick, and try to connect again.
   */
  private tick(): void {
    const gen = this.generation;
    if (this.cancelled(gen)) return;
    if (this.catchUpRequest) {
      if (this.catchUpOutlivedTick) {
        this.abandonCatchUp();
        this.catchUpFailed = true;
      } else {
        this.catchUpOutlivedTick = true;
      }
    }
    if (!this.state.loaded || this.windowStale) {
      void this.loadWindow(gen);
      return;
    }
    if (this.state.connection === "live") {
      if (this.catchUpFailed) void this.catchUp(gen);
      else this.settleTimer();
      return;
    }
    if (this.state.connection !== "polling") this.set({ connection: "polling" });
    if (this.socket) this.discardSocket();
    this.abandonNegotiation();
    void this.catchUp(gen);
    this.connect(gen);
  }

  private ensureTimer(): void {
    if (this.pollTimer || this.stopped) return;
    this.pollTimer = setInterval(() => {
      this.tick();
    }, this.pollMs);
  }

  private startPolling(): void {
    if (this.stopped) return;
    if (this.state.connection !== "polling") this.set({ connection: "polling" });
    this.ensureTimer();
  }

  /** While live, the timer runs only to retry a failed window reload or catch-up. */
  private settleTimer(): void {
    if (this.windowStale || this.catchUpFailed || this.catchUpRequest) this.ensureTimer();
    else this.stopPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * `events?since=lastSeq` until the server has no more; one at a time, a request for a rerun
   * queues. A page can answer after messages have moved the cursor on: only envelopes past the
   * cursor are applied, so an old page never restores an old status.
   */
  private async catchUp(gen: number): Promise<void> {
    if (!this.state.loaded || this.cancelled(gen)) return;
    if (this.catchUpRequest) {
      this.catchUpAgain = true;
      return;
    }
    // A request that never answers would hold every later catch-up back: the timer runs while it
    // is out, and a tick that finds it still out after a whole interval abandons it.
    const controller = new AbortController();
    this.catchUpRequest = controller;
    this.catchUpOutlivedTick = false;
    this.ensureTimer();
    const superseded = () => this.cancelled(gen) || this.catchUpRequest !== controller;
    let ok = false;
    try {
      let more = true;
      while (more) {
        const response = await this.fetchImpl(
          this.url("events", { since: String(this.state.lastSeq) }),
          { signal: controller.signal },
        );
        if (superseded() || this.refused(response)) return;
        const parsed = response.ok ? EventsPage.safeParse(await response.json()) : null;
        if (!parsed?.success || superseded()) return;
        for (const envelope of parsed.data.events) {
          if (envelope.seq > this.state.lastSeq) this.apply(envelope, gen);
        }
        this.set({ lastSeq: Math.max(this.state.lastSeq, parsed.data.lastSeq) });
        more = parsed.data.more;
      }
      ok = true;
    } catch {
      // The next tick or the next message tries again.
    } finally {
      if (this.catchUpRequest === controller) {
        this.catchUpRequest = null;
        if (!this.cancelled(gen)) {
          this.catchUpFailed = !ok;
          if (this.state.connection === "live") this.settleTimer();
        }
        if (this.catchUpAgain) {
          this.catchUpAgain = false;
          void this.catchUp(gen);
        }
      }
    }
  }

  /** Gives up on a catch-up still in flight; its answer, if it ever comes, is ignored. */
  private abandonCatchUp(): void {
    this.catchUpRequest?.abort();
    this.catchUpRequest = null;
    this.catchUpAgain = false;
  }

  /** A pushed message: applied when it is the next sequence, fetched when there is a gap. */
  private receive(data: unknown, gen: number): void {
    let raw: unknown;
    try {
      raw = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return;
    }
    const parsed = EventEnvelope.safeParse(raw);
    if (!parsed.success || parsed.data.spaceId !== this.spaceId) return;
    const envelope = parsed.data;
    if (envelope.seq <= this.state.lastSeq) return;
    if (envelope.seq > this.state.lastSeq + 1) {
      void this.catchUp(gen);
      return;
    }
    this.apply(envelope, gen);
    this.set({ lastSeq: envelope.seq });
  }

  private apply(envelope: EventEnvelope, gen: number): void {
    if (envelope.type !== "reading") {
      this.applyCommon(envelope, gen);
      this.set({ events: [...this.state.events, envelope].slice(-MAX_EVENTS) });
      for (const handler of this.handlers.get(envelope.type) ?? []) {
        try {
          handler(envelope);
        } catch {
          // A screen's bug must not stop the feed or the other handlers.
        }
      }
      return;
    }
    this.applyCommon(envelope, gen);
  }

  /** Readings are keyed by `ts`: the same `ts` again replaces the held entry (plan §5). */
  private putReading(reading: Reading): void {
    const others = this.state.readings.filter((r) => r.ts !== reading.ts);
    const readings = this.prune([...others, reading].sort((a, b) => a.ts.localeCompare(b.ts)));
    // A replaced newest reading must not keep its old value as `latest`.
    const latest =
      this.state.latest?.ts === reading.ts ? reading : newest(reading, this.state.latest);
    this.set({ readings, latest });
  }

  /** What the feed itself does with an event: readings, the source status, window reloads. */
  private applyCommon(envelope: EventEnvelope, gen: number): void {
    switch (envelope.type) {
      case "reading":
        this.putReading(envelope.payload);
        return;
      case "source.status":
        this.set({ sourceStatus: envelope.payload.status, sourceSince: envelope.payload.since });
        return;
      case "readings.imported":
        // Readings arrived in bulk, maybe inside the window: load it again rather than apply
        // thousands of rows one by one. Only an owner or carer's feed can hear this.
        if (!this.withReadings) return;
        this.windowStale = true;
        void this.loadWindow(gen);
        return;
      case "space.updated":
      case "member.updated":
      case "member.removed":
        if (!this.withReadings) {
          // No window to reload, but the removal may be this member's own: taking the socket out
          // of the group does not close it, so ask the server, whose refusal stops the feed.
          if (envelope.type === "member.removed") void this.catchUp(gen);
          return;
        }
        // Unit, target range or timezone may have changed: the window carries them. A member
        // change may be this member's own downgrade or removal: the reload is then refused and the
        // feed stops (the server has already taken the socket out of the glucose group).
        this.windowStale = true;
        void this.loadWindow(gen);
        return;
      default:
        return;
    }
  }

  /**
   * A 403 or 404 means this member may no longer read the space (downgraded to viewer, removed):
   * stop for good, drop every reading held, and say why. Anything else is not a refusal.
   */
  private refused(response: Response): boolean {
    if (response.status !== 403 && response.status !== 404) return false;
    this.stop();
    this.set({
      error: response.status === 403 ? "forbidden" : "not-found",
      loaded: false,
      readings: [],
      latest: null,
    });
    return true;
  }

  private prune(readings: Reading[]): Reading[] {
    const cutoff = this.now().getTime() - this.hours * 60 * 60 * 1000;
    return readings.filter((r) => new Date(r.ts).getTime() >= cutoff);
  }
}

/** The later of two readings by `ts`; either may be missing. */
function newest(a: Reading | null, b: Reading | null): Reading | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.ts) >= Date.parse(b.ts) ? a : b;
}
