import { describe, expect, it } from "vitest";

import { createEventSinkFromEnv, WebPubSubEventSink, type WebPubSubClientLike } from "./pubsub";

function fakeClient() {
  const sent: { group: string; message: unknown }[] = [];
  const tokens: unknown[] = [];
  const client: WebPubSubClientLike = {
    group: (name: string) => ({
      sendToAll: (message: unknown) => {
        sent.push({ group: name, message });
        return Promise.resolve();
      },
    }),
    getClientAccessToken: (options) => {
      tokens.push(options);
      return Promise.resolve({
        url: "wss://example.invalid/client?access_token=x",
        token: "x",
        baseUrl: "",
      });
    },
  };
  return { client, sent, tokens };
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

  it("issues a client token with the groups baked in and no joinLeaveGroup role", async () => {
    const { client, tokens } = fakeClient();
    const token = await new WebPubSubEventSink(client).issueClientToken({
      userId: "u1",
      groups: ["space-s1", "space-s1-glucose"],
    });
    expect(token.url).toContain("access_token");
    expect(tokens).toEqual([
      {
        userId: "u1",
        groups: ["space-s1", "space-s1-glucose"],
        roles: [],
        expirationTimeInMinutes: 60,
      },
    ]);
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
    await expect(sink.issueClientToken({ userId: "u1", groups: [] })).resolves.toBeNull();
  });
});
