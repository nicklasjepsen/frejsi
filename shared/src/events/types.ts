import type { EventEnvelope } from "../schemas/events";

/** Where `emit()` publishes after the row is committed (spec §3b). */
export interface EventSink {
  publish(group: string, envelope: EventEnvelope): Promise<void>;
}

/**
 * What a client token carries: the user and nothing else. No groups and no roles: the hub's
 * `connect` handler (`/api/pubsub`) looks up the member's current role each time a socket connects
 * and joins it to exactly the groups that role allows, so a token issued before a downgrade cannot
 * be replayed into the glucose group (issue #95).
 */
export interface ClientTokenRequest {
  userId: string;
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
 * Takes a user's open connections out of a group at once, server side. The connect handler only
 * runs when a socket connects, so a role change would otherwise reach an open socket only when it
 * reconnects (issue #79). A no-op when no live transport is configured.
 */
export interface LiveGroupRevoker {
  removeUserFromGroup(group: string, userId: string, options?: LiveCallOptions): Promise<void>;
  /**
   * Drops every open connection of the user. The fallback when a group removal fails: the client
   * reconnects, and the connect handler joins it to the groups of the role the user has now.
   */
  closeUserConnections(userId: string, options?: LiveCallOptions): Promise<void>;
}

/** `signal` cuts a slow service call short, so a committed change is not held up by it. */
export interface LiveCallOptions {
  signal?: AbortSignal;
}
