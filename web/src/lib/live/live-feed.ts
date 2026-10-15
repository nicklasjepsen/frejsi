// The client side of the live feed, without React: `LiveFeed` negotiates, connects, catches up
// and polls (plan §5); `useLiveFeed` wraps it. Framework-free so the whole protocol is tested with
// a fake socket and fake timers.
import { EventEnvelope, type ApiErrorCode, type Reading, type SourceStatus } from "@frejsi/shared";

import {
  DEFAULT_WINDOW_HOURS,
  EventsPage,
  type LiveSpace,
  NegotiateResult,
  ReadingsWindow,
} from "./contracts";

/** How often the feed asks for events while the socket is down (spec §3b). */
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
    void this.loadWindow().then((ok) => {
      if (ok) this.connect();
    });
  }

  /** Closes the socket and clears the timer; `start()` begins again from the window. */
  stop(): void {
    this.stopped = true;
    this.stopPolling();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    if (this.state.connection === "live") this.set({ connection: "polling" });
  }

  /** `stopped` as a call, so a check after an `await` is not narrowed away by the one before it. */
  private halted(): boolean {
    return this.stopped;
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
   * `readings?hours=`: the window and the cursor it is consistent with. False when it could not be
   * loaded: a refusal stops the feed, anything else is retried on the poll timer.
   */
  private async loadWindow(): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url("readings", { hours: String(this.hours) }));
    } catch {
      this.startPolling();
      return false;
    }
    if (this.stopped) return false;
    if (response.status === 403 || response.status === 404) {
      this.stopPolling();
      this.stopped = true;
      this.set({ error: response.status === 403 ? "forbidden" : "not-found", loaded: false });
      return false;
    }
    const parsed = response.ok ? ReadingsWindow.safeParse(await response.json()) : null;
    if (!parsed?.success) {
      this.startPolling();
      return false;
    }
    const window = parsed.data;
    this.set({
      loaded: true,
      error: null,
      lastSeq: window.lastSeq,
      readings: this.prune(window.readings),
      sourceStatus: window.sourceStatus,
      sourceSince: window.sourceSince,
      space: window.space,
    });
    return true;
  }

  /** Negotiates a token and opens the socket; without one (503, offline) the feed polls instead. */
  private connect(): void {
    if (this.stopped || this.socket) return;
    void this.fetchImpl(this.url("negotiate"))
      .then(async (response) =>
        response.ok ? NegotiateResult.safeParse(await response.json()) : null,
      )
      .catch(() => null)
      .then((parsed) => {
        if (this.stopped) return;
        if (!parsed?.success) {
          this.set({ connection: "polling" });
          this.startPolling();
          void this.catchUp();
          return;
        }
        this.open(parsed.data.url);
      });
  }

  private open(url: string): void {
    const socket = this.socketFactory(url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.stopPolling();
      this.set({ connection: "live" });
      void this.catchUp();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.receive(event.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.set({ connection: "polling" });
      void this.catchUp();
      this.startPolling();
    };
    socket.onerror = () => {
      // `close` follows an error; nothing to do here.
    };
  }

  /** One tick: reload the window if it never loaded, else re-negotiate (which catches up). */
  private tick(): void {
    if (this.stopped) return;
    if (!this.state.loaded) {
      void this.loadWindow().then((ok) => {
        if (ok) this.connect();
      });
      return;
    }
    this.connect();
  }

  private startPolling(): void {
    if (this.stopped) return;
    if (this.state.connection !== "polling") this.set({ connection: "polling" });
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.tick();
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** `events?since=lastSeq` until the server has no more; one at a time, a request for a rerun queues. */
  private async catchUp(): Promise<void> {
    if (!this.state.loaded) return;
    if (this.catchingUp) {
      this.catchUpAgain = true;
      return;
    }
    this.catchingUp = true;
    try {
      let more = true;
      while (more && !this.halted()) {
        const response = await this.fetchImpl(
          this.url("events", { since: String(this.state.lastSeq) }),
        );
        const parsed = response.ok ? EventsPage.safeParse(await response.json()) : null;
        if (!parsed?.success || this.halted()) return;
        for (const envelope of parsed.data.events) this.apply(envelope);
        this.set({ lastSeq: Math.max(this.state.lastSeq, parsed.data.lastSeq) });
        more = parsed.data.more;
      }
    } catch {
      // The next tick or the next message tries again.
    } finally {
      this.catchingUp = false;
      if (this.catchUpAgain) {
        this.catchUpAgain = false;
        void this.catchUp();
      }
    }
  }

  /** A pushed message: applied when it is the next sequence, fetched when there is a gap. */
  private receive(data: unknown): void {
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
      void this.catchUp();
      return;
    }
    this.apply(envelope);
    this.set({ lastSeq: envelope.seq });
  }

  private apply(envelope: EventEnvelope): void {
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
        void this.loadWindow();
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
