import { DefaultAzureCredential } from "@azure/identity";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

import type { EventEnvelope } from "../schemas/events";
import type { ClientToken, ClientTokenRequest, EventSink, LiveTokenIssuer } from "./types";

/** The slice of `WebPubSubServiceClient` the sink uses; tests pass a fake. */
export interface WebPubSubClientLike {
  group(name: string): { sendToAll(message: EventEnvelope): Promise<void> };
  getClientAccessToken(options: {
    userId: string;
    groups: string[];
    roles: string[];
    expirationTimeInMinutes: number;
  }): Promise<{ url: string }>;
}

export const DEFAULT_HUB = "frejsi";
const TOKEN_MINUTES = 60;

/** The real sink: Web PubSub REST API through the service client (spec §3b). */
export class WebPubSubEventSink implements EventSink, LiveTokenIssuer {
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
}

/** Local dev without `awps-tunnel`: nothing is pushed, `negotiate` answers 503 and clients poll. */
export class NoopEventSink implements EventSink, LiveTokenIssuer {
  publish(): Promise<void> {
    return Promise.resolve();
  }

  issueClientToken(): Promise<null> {
    return Promise.resolve(null);
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
): EventSink & LiveTokenIssuer {
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
