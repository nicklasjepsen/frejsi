import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  APNS_ORIGINS,
  ApnsSender,
  JWT_LIFETIME_SECONDS,
  LIVE_ACTIVITY_TOPIC,
  apnsJwt,
  assertDeviceToken,
  loadApnsKey,
} from "./apns";

const TOKEN = "a1".repeat(32);

interface Seen {
  headers: http2.IncomingHttpHeaders;
  body: string;
}

/** A local cleartext HTTP/2 server that records requests and answers what `reply` says. */
async function apnsStub(
  reply: (seen: Seen) => { status: number; body?: string; apnsId?: string },
): Promise<{ origin: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => {
      const entry = { headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(entry);
      const r = reply(entry);
      stream.respond({ ":status": r.status, ...(r.apnsId ? { "apns-id": r.apnsId } : {}) });
      stream.end(r.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

let keyP8: string;
let publicPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  keyP8 = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publicPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
});

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

function sender(origin: string, now: () => number = () => 1793016000) {
  const s = new ApnsSender({
    keyP8,
    keyId: "KEYID12345",
    teamId: "TEAMID1234",
    topic: LIVE_ACTIVITY_TOPIC,
    environment: "sandbox",
    origin,
    now,
  });
  closers.push(() => {
    s.close();
  });
  return s;
}

function decodeJwt(jwt: string) {
  const [h, c, s] = jwt.split(".") as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(c, "base64url").toString()) as Record<string, unknown>,
    valid: verify(
      "sha256",
      Buffer.from(`${h}.${c}`),
      { key: createPublicKey(publicPem), dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    ),
  };
}

describe("apnsJwt", () => {
  it("is an ES256 JWT with kid, iss and iat, verifiable with the key's public half", () => {
    const jwt = decodeJwt(apnsJwt(loadApnsKey(keyP8), "K", "T", 42));
    expect(jwt.header).toEqual({ alg: "ES256", kid: "K" });
    expect(jwt.claims).toEqual({ iss: "T", iat: 42 });
    expect(jwt.valid).toBe(true);
  });
});

describe("ApnsSender", () => {
  it("refuses a key that is not an EC private key, without echoing it", () => {
    expect(
      () =>
        new ApnsSender({
          keyP8: "not a key",
          keyId: "K",
          teamId: "T",
          topic: LIVE_ACTIVITY_TOPIC,
          environment: "sandbox",
        }),
    ).toThrow("the APNs key is not a PEM private key");
  });

  it("refuses an RSA key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(() => loadApnsKey(rsa)).toThrow("the APNs key is not an EC key");
  });

  it("picks Apple's sandbox or production host", () => {
    expect(APNS_ORIGINS.sandbox).toBe("https://api.sandbox.push.apple.com");
    expect(APNS_ORIGINS.production).toBe("https://api.push.apple.com");
  });

  it("posts a Live Activity push with Apple's headers and a valid provider token", async () => {
    const stub = await apnsStub(() => ({ status: 200, apnsId: "id-1" }));
    closers.push(stub.close);
    const result = await sender(stub.origin).send({
      deviceToken: TOKEN,
      pushType: "liveactivity",
      priority: 10,
      payload: { aps: { event: "update" } },
      expiration: 0,
    });
    expect(result).toEqual({ status: 200, apnsId: "id-1" });
    const [request] = stub.seen;
    expect(request?.headers[":method"]).toBe("POST");
    expect(request?.headers[":path"]).toBe(`/3/device/${TOKEN}`);
    expect(request?.headers["apns-topic"]).toBe("ninja.jepsen.naensom.push-type.liveactivity");
    expect(request?.headers["apns-push-type"]).toBe("liveactivity");
    expect(request?.headers["apns-priority"]).toBe("10");
    expect(request?.headers["apns-expiration"]).toBe("0");
    expect(JSON.parse(request?.body ?? "")).toEqual({ aps: { event: "update" } });
    const auth = String(request?.headers.authorization);
    expect(auth.startsWith("bearer ")).toBe(true);
    const jwt = decodeJwt(auth.slice("bearer ".length));
    expect(jwt.valid).toBe(true);
    expect(jwt.header.kid).toBe("KEYID12345");
    expect(jwt.claims).toEqual({ iss: "TEAMID1234", iat: 1793016000 });
  });

  it("sends an alert to the bundle's own topic", async () => {
    const stub = await apnsStub(() => ({ status: 200 }));
    closers.push(stub.close);
    await sender(stub.origin).send({
      deviceToken: TOKEN,
      pushType: "alert",
      priority: 10,
      payload: { aps: {} },
    });
    expect(stub.seen[0]?.headers["apns-topic"]).toBe("ninja.jepsen.naensom");
    expect(stub.seen[0]?.headers["apns-expiration"]).toBeUndefined();
  });

  it("answers Apple's refusal as status and reason, reusing one connection", async () => {
    const stub = await apnsStub(() => ({ status: 400, body: '{"reason":"BadDeviceToken"}' }));
    closers.push(stub.close);
    const s = sender(stub.origin);
    const push = {
      deviceToken: TOKEN,
      pushType: "liveactivity" as const,
      priority: 5 as const,
      payload: {},
    };
    expect(await s.send(push)).toEqual({ status: 400, reason: "BadDeviceToken" });
    expect(await s.send(push)).toEqual({ status: 400, reason: "BadDeviceToken" });
    expect(stub.seen).toHaveLength(2);
  });

  it("keeps the provider token for 50 minutes, renews it after, and drops it when Apple calls it expired", async () => {
    let now = 1000;
    let expired = false;
    const stub = await apnsStub(() =>
      expired ? { status: 403, body: '{"reason":"ExpiredProviderToken"}' } : { status: 200 },
    );
    closers.push(stub.close);
    const s = sender(stub.origin, () => now);
    const push = {
      deviceToken: TOKEN,
      pushType: "liveactivity" as const,
      priority: 10 as const,
      payload: {},
    };
    await s.send(push);
    now += JWT_LIFETIME_SECONDS - 1;
    await s.send(push);
    now += 1;
    await s.send(push);
    const iats = stub.seen.map(
      (r) => decodeJwt(String(r.headers.authorization).slice(7)).claims.iat,
    );
    expect(iats).toEqual([1000, 1000, 1000 + JWT_LIFETIME_SECONDS]);

    expired = true;
    now += 60;
    expect((await s.send(push)).reason).toBe("ExpiredProviderToken");
    expired = false;
    await s.send(push);
    expect(decodeJwt(String(stub.seen.at(-1)?.headers.authorization).slice(7)).claims.iat).toBe(
      now,
    );
  });

  it("refuses a token that is not hex before connecting, and never repeats it", async () => {
    const s = sender("http://127.0.0.1:1");
    const bad = "not-a-token/../x";
    await expect(
      s.send({ deviceToken: bad, pushType: "liveactivity", priority: 10, payload: {} }),
    ).rejects.toThrow(/^device token is not hex$/);
    expect(() => {
      assertDeviceToken(TOKEN.toUpperCase());
    }).toThrow();
  });

  it("rejects with a plain message when Apple cannot be reached", async () => {
    const s = sender("http://127.0.0.1:1");
    await expect(
      s.send({ deviceToken: TOKEN, pushType: "liveactivity", priority: 10, payload: {} }),
    ).rejects.toThrow(/^APNs (request|connection) failed$/);
  });
});
