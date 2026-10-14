import type { EventEnvelope } from "../schemas/events";

/** Where `emit()` publishes after the row is committed (spec §3b). */
export interface EventSink {
  publish(group: string, envelope: EventEnvelope): Promise<void>;
}

export interface ClientTokenRequest {
  userId: string;
  /** Baked into the token and auto-joined; the client cannot join anything else. */
  groups: string[];
}

export interface ClientToken {
  /** The websocket URL with the access token in the query string. */
  url: string;
}

/** Issues the client token `/api/spaces/:id/negotiate` hands out; null when no live transport is configured. */
export interface LiveTokenIssuer {
  issueClientToken(request: ClientTokenRequest): Promise<ClientToken | null>;
}
