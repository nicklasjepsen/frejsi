// The client side of the live feed, without React: `LiveFeed` negotiates, connects, catches up
// and polls (plan §5); `useLiveFeed` wraps it. Framework-free so the whole protocol is tested with
// a fake socket and fake timers.
import {
  EventEnvelope,
  type ApiErrorCode,
  type Reading,
  type SourceStatus,
} from "@frejsi/shared/schemas/index";

import {
  DEFAULT_WINDOW_HOURS,
  EventsPage,
  type LiveSpace,
  NegotiateResult,
  ReadingsWindow,
} from "./contracts";

/** How often the feed asks for events while the socket is not live (spec §3b). */
export const POLL_MS = 30_000;

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
  sourceStatus: SourceStatus;
  sourceSince: string | null;
  space: LiveSpace | null;
  /** A refusal of the readings window (403 for a viewer, 404 for a non-member); the feed stops. */
  error: ApiErrorCode | null;
}

export interface LiveFeedOptions {
  spaceId: string;
  /** The readings window, 1..24 hours; the day curve needs 24. */
  hours?: number;
  fetch?: typeof fetch;
  socketFactory?: SocketFactory;
  now?: () => Date;
  pollMs?: number;
}

const INITIAL: LiveState = {
  loaded: false,
  connection: "connecting",
  lastSeq: 0,
  readings: [],
  sourceStatus: "not-configured",
  sourceSince: null,
  space: null,
  error: null,
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
  private state: LiveState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly spaceId: string;
  private readonly hours: number;
  private readonly fetchImpl: typeof fetch;
  private readonly socketFactory: SocketFactory;
  private readonly now: () => Date;
  private readonly pollMs: number;
  private socket: SocketLike | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  /** Bumped by every `start()` and `stop()`: async work from an earlier life bails out. */
  private generation = 0;
  /** The negotiate request in flight, if any. */
  private negotiation: AbortController | null = null;
  /** A window reload (`space.updated`) that has not succeeded yet; the tick retries it. */
  private windowStale = false;
  private catchingUp = false;
  private catchUpAgain = false;

  constructor(options: LiveFeedOptions) {
    this.spaceId = options.spaceId;
    this.hours = options.hours ?? DEFAULT_WINDOW_HOURS;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date());
    this.pollMs = options.pollMs ?? POLL_MS;
  }

  getState = (): LiveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
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
    this.stopPolling();
    this.discardSocket();
    if (this.state.connection === "live") this.set({ connection: "polling" });
  }

  /** True when `gen` is not the running life: its result is thrown away. */
  private cancelled(gen: number): boolean {
    return this.stopped || gen !== this.generation;
  }

  private set(patch: Partial<LiveState>): void {
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
    let body: unknown = null;
    try {
      const response = await this.fetchImpl(this.url("readings", { hours: String(this.hours) }));
      if (this.cancelled(gen)) return;
      if (response.status === 403 || response.status === 404) {
        this.stop();
        this.set({ error: response.status === 403 ? "forbidden" : "not-found", loaded: false });
        return;
      }
      if (response.ok) body = await response.json();
    } catch {
      body = null;
    }
    if (this.cancelled(gen)) return;
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
      sourceStatus: window.sourceStatus,
      sourceSince: window.sourceSince,
      space: window.space,
    });
    if (before.loaded && before.lastSeq > window.lastSeq) void this.catchUp(gen);
    if (this.state.connection === "live") this.stopPolling();
    else this.connect(gen);
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
      .then(async (response) =>
        response.ok ? NegotiateResult.safeParse(await response.json()) : null,
      )
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
      this.stopPolling();
      this.set({ connection: "live" });
      void this.catchUp(gen);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.cancelled(gen)) return;
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
    if (!this.state.loaded || this.windowStale) {
      void this.loadWindow(gen);
      return;
    }
    if (this.state.connection === "live") {
      this.stopPolling();
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
    if (this.catchingUp) {
      this.catchUpAgain = true;
      return;
    }
    this.catchingUp = true;
    try {
      let more = true;
      while (more) {
        const response = await this.fetchImpl(
          this.url("events", { since: String(this.state.lastSeq) }),
        );
        if (this.cancelled(gen)) return;
        const parsed = response.ok ? EventsPage.safeParse(await response.json()) : null;
        if (!parsed?.success || this.cancelled(gen)) return;
        for (const envelope of parsed.data.events) {
          if (envelope.seq > this.state.lastSeq) this.apply(envelope, gen);
        }
        this.set({ lastSeq: Math.max(this.state.lastSeq, parsed.data.lastSeq) });
        more = parsed.data.more;
      }
    } catch {
      // The next tick or the next message tries again.
    } finally {
      this.catchingUp = false;
      if (this.catchUpAgain) {
        this.catchUpAgain = false;
        void this.catchUp(gen);
      }
    }
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
    switch (envelope.type) {
      case "reading": {
        const others = this.state.readings.filter((r) => r.ts !== envelope.payload.ts);
        const readings = this.prune(
          [...others, envelope.payload].sort((a, b) => a.ts.localeCompare(b.ts)),
        );
        this.set({ readings });
        return;
      }
      case "source.status":
        this.set({ sourceStatus: envelope.payload.status, sourceSince: envelope.payload.since });
        return;
      case "space.updated":
        // Unit, target range or timezone may have changed: the window carries them.
        this.windowStale = true;
        void this.loadWindow(gen);
        return;
      default:
        return;
    }
  }

  private prune(readings: Reading[]): Reading[] {
    const cutoff = this.now().getTime() - this.hours * 60 * 60 * 1000;
    return readings.filter((r) => new Date(r.ts).getTime() >= cutoff);
  }
}
