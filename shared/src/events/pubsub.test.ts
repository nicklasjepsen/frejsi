import { describe, expect, it } from "vitest";

import {
  createEventSinkFromEnv,
  CompositeEventSink,
  WebPubSubEventSink,
  type WebPubSubClientLike,
} from "./pubsub";

function fakeClient() {
  const sent: { group: string; message: unknown }[] = [];
  const tokens: unknown[] = [];
  const removed: { group: string; userId: string; signal?: AbortSignal | undefined }[] = [];
  const closed: { userId: string; signal?: AbortSignal | undefined }[] = [];
  const client: WebPubSubClientLike = {
    group: (name: string) => ({
      sendToAll: (message: unknown) => {
        sent.push({ group: name, message });
        return Promise.resolve();
      },
      removeUser: (userId: string, options?: { abortSignal?: AbortSignal }) => {
        removed.push({ group: name, userId, signal: options?.abortSignal });
        return Promise.resolve();
      },
    }),
    closeUserConnections: (userId: string, options?: { abortSignal?: AbortSignal }) => {
      closed.push({ userId, signal: options?.abortSignal });
      return Promise.resolve();
    },
    getClientAccessToken: (options) => {
      tokens.push(options);
      return Promise.resolve({
        url: "wss://example.invalid/client?access_token=x",
        token: "x",
        baseUrl: "",
      });
    },
  };
  return { client, sent, tokens, removed, closed };
}

const envelope = {
  spaceId: "s1",
  seq: 3,
  ts: "2026-10-15T08:00:00.000Z",
  type: "member.joined" as const,
  payload: { userId: "u1", role: "carer" as const },
};

describe("WebPubSubEventSink", () => {
  it("sends the envelope to the named group", async () => {
    const { client, sent } = fakeClient();
    await new WebPubSubEventSink(client).publish("space-s1", envelope);
    expect(sent).toEqual([{ group: "space-s1", message: envelope }]);
  });

  it("issues a client token with no groups and no roles: the connect handler decides (issue #95)", async () => {
    const { client, tokens } = fakeClient();
    const token = await new WebPubSubEventSink(client).issueClientToken({ userId: "u1" });
    expect(token.url).toContain("access_token");
    expect(tokens).toEqual([
      {
        userId: "u1",
        groups: [],
        roles: [],
        expirationTimeInMinutes: 1,
      },
    ]);
  });

  it("never bakes a group into a token, whatever a caller passes by mistake", async () => {
    const { client, tokens } = fakeClient();
    const sneaky = { userId: "u1", groups: ["space-s1-glucose"] } as { userId: string };
    await new WebPubSubEventSink(client).issueClientToken(sneaky);
    expect(tokens).toEqual([expect.objectContaining({ groups: [], roles: [] })]);
  });
});

describe("WebPubSubEventSink.removeUserFromGroup", () => {
  it("takes every open connection of the user out of the named group (issue #79)", async () => {
    const { client, removed } = fakeClient();
    await new WebPubSubEventSink(client).removeUserFromGroup("space-s1-glucose", "u1");
    expect(removed).toEqual([{ group: "space-s1-glucose", userId: "u1" }]);
  });

  it("passes the caller's abort signal on, so a slow service call can be cut short", async () => {
    const { client, removed, closed } = fakeClient();
    const signal = new AbortController().signal;
    const sink = new WebPubSubEventSink(client);
    await sink.removeUserFromGroup("space-s1-glucose", "u1", { signal });
    await sink.closeUserConnections("u1", { signal });
    expect(removed[0]?.signal).toBe(signal);
    expect(closed).toEqual([{ userId: "u1", signal }]);
  });
});

describe("createEventSinkFromEnv", () => {
  it("uses the connection string when present (web), else the endpoint with the identity (poller)", () => {
    const seen: string[] = [];
    const factory = {
      fromConnectionString: (conn: string, hub: string) => {
        seen.push(`conn:${hub}`);
        return fakeClient().client;
      },
      fromEndpoint: (endpoint: string, hub: string) => {
        seen.push(`endpoint:${endpoint}:${hub}`);
        return fakeClient().client;
      },
    };
    createEventSinkFromEnv(
      {
        WEB_PUBSUB_CONNECTION_STRING: "Endpoint=https://x;AccessKey=y;Version=1.0;",
        WEB_PUBSUB_HUB: "frejsi",
      },
      factory,
    );
    createEventSinkFromEnv({ WEB_PUBSUB_ENDPOINT: "https://x.webpubsub.azure.com" }, factory);
    expect(seen).toEqual(["conn:frejsi", "endpoint:https://x.webpubsub.azure.com:frejsi"]);
  });

  it("falls back to a sink that publishes nowhere and issues no token when nothing is configured", async () => {
    const sink = createEventSinkFromEnv({});
    await expect(sink.publish("space-s1", envelope)).resolves.toBeUndefined();
    await expect(sink.issueClientToken({ userId: "u1" })).resolves.toBeNull();
    await expect(sink.removeUserFromGroup("space-s1-glucose", "u1")).resolves.toBeUndefined();
    await expect(sink.closeUserConnections("u1")).resolves.toBeUndefined();
  });
});

it("composes push when VAPID is complete and preserves live token and revocation methods", async () => {
  const { client, tokens, removed } = fakeClient();
  const sink = createEventSinkFromEnv(
    {
      WEB_PUBSUB_ENDPOINT: "https://pubsub.example",
      VAPID_PRIVATE_KEY: "fictional",
      VAPID_PUBLIC_KEY: "fictional",
      VAPID_SUBJECT: "https://frejsi.example",
    },
    { fromEndpoint: () => client, fromConnectionString: () => client },
  );
  expect(sink).toBeInstanceOf(CompositeEventSink);
  await sink.publish("space-s1", envelope);
  await sink.issueClientToken({ userId: "u1" });
  await sink.removeUserFromGroup("space-s1", "u1");
  expect(tokens).toHaveLength(1);
  expect(removed).toEqual([{ group: "space-s1", userId: "u1" }]);
});
it("still delivers push after live delivery fails", async () => {
  const seen: unknown[] = [];
  const live = new WebPubSubEventSink(fakeClient().client);
  live.publish = () => Promise.reject(new Error("Fictional service failure"));
  const sink = new CompositeEventSink(live, {
    publish: (group, event) => {
      seen.push({ group, event });
      return Promise.resolve();
    },
  });
  await expect(sink.publish("space-s1", envelope)).rejects.toThrow("Event sink failed");
  expect(seen).toEqual([{ group: "space-s1", event: envelope }]);
});
