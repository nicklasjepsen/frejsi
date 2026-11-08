import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import http2 from "node:http2";

/**
 * Apple Push Notification service, token-based (plan 2026-11-08-ios-follower-app §4): one `.p8`
 * signing key, an ES256 JWT in the `authorization` header, HTTP/2 to Apple's host. Used by the
 * stage-2 `push-test` CLI now and by the `live-poll` relay in stage 4.
 *
 * Nothing here logs. A device token, the key and a payload never reach an error message: a failed
 * send answers Apple's status and `reason` code only.
 */

/** Apple's two hosts. A development build (and the Simulator) gets its tokens from the sandbox. */
export const APNS_ORIGINS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;
export type ApnsEnvironment = keyof typeof APNS_ORIGINS;

/** The app's Live Activity topic: the bundle ID plus `.push-type.liveactivity`. */
export const LIVE_ACTIVITY_TOPIC = "ninja.jepsen.naensom.push-type.liveactivity";
export const APNS_KEY_ID = "P9HBN8RRS3";
export const APNS_TEAM_ID = "B32HGH682W";
/** The Key Vault secret holding the `.p8` file's PEM text. */
export const APNS_KEY_SECRET = "apns-key-p8";

/** Apple refuses a token older than an hour and throttles one renewed more than every 20 minutes. */
export const JWT_LIFETIME_SECONDS = 50 * 60;
export const REQUEST_TIMEOUT_MS = 15_000;

export interface ApnsConfig {
  /** The `.p8` file's contents (PKCS#8 PEM, an EC P-256 key). */
  keyP8: string;
  keyId: string;
  teamId: string;
  topic: string;
  environment: ApnsEnvironment;
  /** Overrides the environment's host; tests point it at a local HTTP/2 server. */
  origin?: string;
  /** Seconds since the epoch; tests fix it. */
  now?: () => number;
}

export type ApnsPushType = "liveactivity" | "alert" | "background";

export interface ApnsRequest {
  /** The device's (or activity's) push token, hex. */
  deviceToken: string;
  pushType: ApnsPushType;
  /** 10 delivers now; 5 lets the device pick a moment and saves Apple's update budget. */
  priority: 5 | 10;
  payload: object;
  /** Unix seconds after which Apple stops trying; 0 means try once. */
  expiration?: number;
}

export interface ApnsResult {
  status: number;
  /** Apple's id for the notification, when it answered one. */
  apnsId?: string;
  /** Apple's reason code on a refusal (`BadDeviceToken`, `ExpiredProviderToken`, …). */
  reason?: string;
}

const DEVICE_TOKEN = /^[0-9a-f]{32,400}$/;

/** Throws unless the token is lower-case hex; the message never repeats the token. */
export function assertDeviceToken(token: string): void {
  if (!DEVICE_TOKEN.test(token)) throw new Error("device token is not hex");
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** The provider token: `{alg: ES256, kid}.{iss: team, iat}`, signed with the `.p8` key. */
export function apnsJwt(key: KeyObject, keyId: string, teamId: string, issuedAt: number): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: issuedAt }));
  const input = `${header}.${claims}`;
  // JWS wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${base64url(signature)}`;
}

/** The `.p8` text as a signing key; refuses anything but an EC private key, without echoing it. */
export function loadApnsKey(keyP8: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(keyP8);
  } catch {
    throw new Error("the APNs key is not a PEM private key");
  }
  if (key.asymmetricKeyType !== "ec") throw new Error("the APNs key is not an EC key");
  return key;
}

export class ApnsSender {
  private readonly key: KeyObject;
  private readonly origin: string;
  private readonly now: () => number;
  private session: http2.ClientHttp2Session | undefined;
  private jwt: { token: string; issuedAt: number } | undefined;

  constructor(private readonly config: ApnsConfig) {
    this.key = loadApnsKey(config.keyP8);
    this.origin = config.origin ?? APNS_ORIGINS[config.environment];
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** The cached provider token, renewed after 50 minutes. */
  providerToken(): string {
    const now = this.now();
    if (!this.jwt || now - this.jwt.issuedAt >= JWT_LIFETIME_SECONDS) {
      this.jwt = {
        token: apnsJwt(this.key, this.config.keyId, this.config.teamId, now),
        issuedAt: now,
      };
    }
    return this.jwt.token;
  }

  async send(request: ApnsRequest): Promise<ApnsResult> {
    assertDeviceToken(request.deviceToken);
    const body = JSON.stringify(request.payload);
    const headers: http2.OutgoingHttpHeaders = {
      ":method": "POST",
      ":path": `/3/device/${request.deviceToken}`,
      authorization: `bearer ${this.providerToken()}`,
      "apns-topic": this.topicFor(request.pushType),
      "apns-push-type": request.pushType,
      "apns-priority": String(request.priority),
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    };
    if (request.expiration !== undefined) headers["apns-expiration"] = String(request.expiration);

    const result = await this.request(headers, body);
    // Apple says to make a new provider token when it calls ours expired.
    if (result.reason === "ExpiredProviderToken") this.jwt = undefined;
    return result;
  }

  /**
   * Closes the HTTP/2 connection; the next send opens a new one. The open connection keeps the
   * process alive (it is not unref'd, so a CLI cannot exit mid-send), so call this when done.
   */
  close(): void {
    this.session?.close();
    this.session = undefined;
  }

  private topicFor(pushType: ApnsPushType): string {
    // A Live Activity push goes to `<bundle>.push-type.liveactivity`; anything else to the bundle.
    if (pushType === "liveactivity") return this.config.topic;
    return this.config.topic.replace(/\.push-type\.liveactivity$/, "");
  }

  private connection(): http2.ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const session = http2.connect(this.origin);
    // A dropped connection is reopened on the next send; the error itself carries no token.
    session.on("error", () => {
      if (this.session === session) this.session = undefined;
    });
    session.on("goaway", () => {
      if (this.session === session) this.session = undefined;
    });
    session.on("close", () => {
      if (this.session === session) this.session = undefined;
    });
    this.session = session;
    return session;
  }

  private request(headers: http2.OutgoingHttpHeaders, body: string): Promise<ApnsResult> {
    return new Promise((resolve, reject) => {
      let stream: http2.ClientHttp2Stream;
      try {
        stream = this.connection().request(headers);
      } catch {
        reject(new Error("APNs connection failed"));
        return;
      }
      let status = 0;
      let apnsId: string | undefined;
      const chunks: Buffer[] = [];
      stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new Error("APNs request timed out"));
      });
      stream.on("response", (responseHeaders) => {
        status = responseHeaders[":status"] ?? 0;
        const id = responseHeaders["apns-id"];
        if (typeof id === "string") apnsId = id;
      });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", () => {
        reject(new Error("APNs request failed"));
      });
      stream.on("end", () => {
        const result: ApnsResult = { status };
        if (apnsId !== undefined) result.apnsId = apnsId;
        const reason = parseReason(Buffer.concat(chunks).toString("utf8"));
        if (reason !== undefined) result.reason = reason;
        resolve(result);
      });
      stream.end(body);
    });
  }
}

/** Apple's error body is `{"reason":"BadDeviceToken"}`; only a plain word is kept. */
function parseReason(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { reason?: unknown };
    return typeof parsed.reason === "string" && /^[A-Za-z]{1,64}$/.test(parsed.reason)
      ? parsed.reason
      : undefined;
  } catch {
    return undefined;
  }
}
