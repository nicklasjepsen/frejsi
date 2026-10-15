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

/**
 * Takes a user's open connections out of a group at once, server side. A token's groups are baked
 * in and auto-joined, so a role change would otherwise reach the socket only when it reconnects
 * (issue #79). A no-op when no live transport is configured.
 */
export interface LiveGroupRevoker {
  removeUserFromGroup(group: string, userId: string, options?: LiveCallOptions): Promise<void>;
  /**
   * Drops every open connection of the user. The fallback when a group removal fails: the client
   * reconnects through `negotiate`, which issues a token for the role the user has now.
   */
  closeUserConnections(userId: string, options?: LiveCallOptions): Promise<void>;
}

/** `signal` cuts a slow service call short, so a committed change is not held up by it. */
export interface LiveCallOptions {
  signal?: AbortSignal;
}
