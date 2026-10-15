// The Web PubSub upstream side of the live feed: the hub calls `/api/pubsub` when a socket connects
// (issue #95). Server only. The request is trusted only when its `ce-signature` is an HMAC of the
// connection id under the hub's access key, and only for this app's own Web PubSub origin.
import { createHmac, timingSafeEqual } from "node:crypto";

import { DEFAULT_HUB } from "@frejsi/shared";

/** What the connect handler needs to trust a request; null when no Web PubSub is configured. */
export interface UpstreamConfig {
  /** The access keys a valid `ce-signature` may be made with. */
  accessKeys: string[];
  /** The service host the requests come from (`WebHook-Request-Origin`), lower case. */
  origin: string;
  /** The hub the requests must be for, lower case (hub names are case-insensitive). */
  hub: string;
}

/**
 * The key and the origin from `WEB_PUBSUB_CONNECTION_STRING`, the same setting `negotiate` signs
 * client tokens with, and the hub from `WEB_PUBSUB_HUB`. No new secret: the service signs every
 * upstream request with that key, so a request that verifies came from the service.
 */
export function upstreamConfigFrom(env: Record<string, string | undefined>): UpstreamConfig | null {
  const connectionString = env.WEB_PUBSUB_CONNECTION_STRING;
  if (!connectionString) return null;
  const fields = new Map<string, string>();
  for (const part of connectionString.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    fields.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  const accessKey = fields.get("accesskey");
  const endpoint = fields.get("endpoint");
  if (!accessKey || !endpoint) return null;
  let origin: string;
  try {
    origin = new URL(endpoint).host.toLowerCase();
  } catch {
    return null;
  }
  return {
    accessKeys: [accessKey],
    origin,
    hub: (env.WEB_PUBSUB_HUB ?? DEFAULT_HUB).toLowerCase(),
  };
}

/**
 * True when one of the comma-separated `sha256=<hex>` values in `ce-signature` is the HMAC-SHA256
 * of the connection id under one of the keys. The service sends one per key it holds (primary and
 * secondary), so a key rotation keeps working while the app still has either.
 */
export function signatureValid(
  header: string | null,
  connectionId: string | null,
  accessKeys: string[],
): boolean {
  if (!header || !connectionId) return false;
  const offered = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("sha256="))
    .map((part) => Buffer.from(part.slice("sha256=".length).toLowerCase(), "utf8"));
  return accessKeys.some((key) => {
    const expected = Buffer.from(
      createHmac("sha256", key).update(connectionId).digest("hex"),
      "utf8",
    );
    return offered.some(
      (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
    );
  });
}

/** True when `WebHook-Request-Origin` names this app's own Web PubSub service. */
export function originAllowed(header: string | null, config: UpstreamConfig): boolean {
  return header !== null && header.trim().toLowerCase() === config.origin;
}
