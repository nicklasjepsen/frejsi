import { DefaultAzureCredential } from "@azure/identity";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

import type { EventEnvelope } from "../schemas/events";
import type {
  ClientToken,
  ClientTokenRequest,
  EventSink,
  LiveCallOptions,
  LiveGroupRevoker,
  LiveTokenIssuer,
} from "./types";

/** The slice of `WebPubSubServiceClient` the sink uses; tests pass a fake. */
export interface WebPubSubClientLike {
  group(name: string): {
    sendToAll(message: EventEnvelope): Promise<void>;
    removeUser(userId: string, options?: { abortSignal?: AbortSignal }): Promise<void>;
  };
  closeUserConnections(userId: string, options?: { abortSignal?: AbortSignal }): Promise<void>;
  getClientAccessToken(options: {
    userId: string;
    groups: string[];
    roles: string[];
    expirationTimeInMinutes: number;
  }): Promise<{ url: string }>;
}

export const DEFAULT_HUB = "frejsi";
/**
 * Only checked when a socket connects: an open socket outlives it, and the client negotiates
 * afresh on every reconnect, so the token is needed for seconds. The service minimum, so a token
 * issued before a downgrade or removal can be replayed for at most a minute to rejoin the glucose
 * group (issue #79). A connect-time role check would close that minute.
 */
const TOKEN_MINUTES = 1;

/** The real sink: Web PubSub REST API through the service client (spec §3b). */
export class WebPubSubEventSink implements EventSink, LiveTokenIssuer, LiveGroupRevoker {
  constructor(private readonly client: WebPubSubClientLike) {}

  async publish(group: string, envelope: EventEnvelope): Promise<void> {
    await this.client.group(group).sendToAll(envelope);
  }

  /** Groups are baked into the token and auto-joined; no `joinLeaveGroup` role (plan decision 3). */
  async issueClientToken(request: ClientTokenRequest): Promise<ClientToken> {
    const token = await this.client.getClientAccessToken({
      userId: request.userId,
      groups: request.groups,
      roles: [],
      expirationTimeInMinutes: TOKEN_MINUTES,
    });
    return { url: token.url };
  }

  async removeUserFromGroup(
    group: string,
    userId: string,
    options: LiveCallOptions = {},
  ): Promise<void> {
    await this.client.group(group).removeUser(userId, sdkOptions(options));
  }

  async closeUserConnections(userId: string, options: LiveCallOptions = {}): Promise<void> {
    await this.client.closeUserConnections(userId, sdkOptions(options));
  }
}

function sdkOptions(options: LiveCallOptions): { abortSignal?: AbortSignal } {
  return options.signal ? { abortSignal: options.signal } : {};
}

/** Local dev without `awps-tunnel`: nothing is pushed, `negotiate` answers 503 and clients poll. */
export class NoopEventSink implements EventSink, LiveTokenIssuer, LiveGroupRevoker {
  publish(): Promise<void> {
    return Promise.resolve();
  }

  issueClientToken(): Promise<null> {
    return Promise.resolve(null);
  }

  removeUserFromGroup(): Promise<void> {
    return Promise.resolve();
  }

  closeUserConnections(): Promise<void> {
    return Promise.resolve();
  }
}

export interface WebPubSubClientFactory {
  fromConnectionString(connectionString: string, hub: string): WebPubSubClientLike;
  fromEndpoint(endpoint: string, hub: string): WebPubSubClientLike;
}

const defaultFactory: WebPubSubClientFactory = {
  fromConnectionString: (connectionString, hub) =>
    new WebPubSubServiceClient(connectionString, hub),
  fromEndpoint: (endpoint, hub) =>
    new WebPubSubServiceClient(endpoint, new DefaultAzureCredential(), hub),
};

/** `process.env` or a plain object with the same keys. */
export type PubSubEnv = Record<string, string | undefined>;

/**
 * The web app has a connection string in its app settings (no usable managed identity on Static
 * Web Apps); the poller has the endpoint and its managed identity (plan §5, §7).
 */
export function createEventSinkFromEnv(
  env: PubSubEnv = process.env,
  factory: WebPubSubClientFactory = defaultFactory,
): EventSink & LiveTokenIssuer & LiveGroupRevoker {
  const hub = env.WEB_PUBSUB_HUB ?? DEFAULT_HUB;
  const connectionString = env.WEB_PUBSUB_CONNECTION_STRING;
  const endpoint = env.WEB_PUBSUB_ENDPOINT;
  if (connectionString) {
    return new WebPubSubEventSink(factory.fromConnectionString(connectionString, hub));
  }
  if (endpoint) {
    return new WebPubSubEventSink(factory.fromEndpoint(endpoint, hub));
  }
  return new NoopEventSink();
}
