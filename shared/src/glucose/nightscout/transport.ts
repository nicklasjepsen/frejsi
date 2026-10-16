import { createHash } from "node:crypto";

import type { NightscoutCredential } from "../../schemas/glucose";
import { AUTH_HEADER, ENDPOINTS } from "./protocol";

/** The slice of `fetch` the adapter uses; tests pass one that serves the fixtures. */
export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "manual";
  },
) => Promise<Pick<Response, "ok" | "status" | "text">>;

/** The production `fetch`; with the Dexcom transport, the only call of it under `shared/src/glucose/` (lint). */
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

/**
 * Hard rule (CLAUDE.md): glucose sources are read-only. A Nightscout site accepts writes
 * (treatments, entries, profile) with the same credential; this map is the whole set of calls
 * Frejsi makes, and a path is sent only when it is listed here with the method given.
 */
export const READ_ONLY_ENDPOINTS: ReadonlyMap<string, string> = freezeMap(
  new Map(Object.values(ENDPOINTS).map((endpoint) => [endpoint.path, endpoint.method])),
);

/** Thrown before any request is made when a call is not on the allow-list. */
export class ReadOnlyEndpointError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
  ) {
    super(
      `Nightscout: ${method} ${path} is not an allow-listed read; glucose sources are read-only (CLAUDE.md)`,
    );
    this.name = "ReadOnlyEndpointError";
  }
}

export interface NightscoutRequest {
  /** The site's address from the credential. Never logged, never put in an error. */
  baseUrl: string;
  path: string;
  method: string;
  query?: URLSearchParams;
  auth: Pick<NightscoutCredential, "token" | "apiSecret">;
  signal: AbortSignal;
}

/** The `api-secret` value: the SHA-1 hex of the API secret, or the access token as given. */
export function authValue(auth: NightscoutRequest["auth"]): string {
  if (auth.apiSecret !== undefined) {
    return createHash("sha1").update(auth.apiSecret).digest("hex");
  }
  return auth.token ?? "";
}

/**
 * The one function that talks to a Nightscout site. It refuses, before `fetch` is called, any path
 * and method pair that is not in `READ_ONLY_ENDPOINTS`. The credential goes in the `api-secret`
 * header, never in the URL; redirects are not followed, so the header cannot be handed to another
 * host.
 */
export async function sendNightscoutRequest(
  fetch: FetchLike,
  request: NightscoutRequest,
): ReturnType<FetchLike> {
  const { baseUrl, path, method, query, auth, signal } = request;
  if (READ_ONLY_ENDPOINTS.get(path) !== method) throw new ReadOnlyEndpointError(method, path);
  const search = query && query.size > 0 ? `?${query.toString()}` : "";
  return fetch(`${baseUrl.replace(/\/+$/, "")}${path}${search}`, {
    method,
    headers: { accept: "application/json", "user-agent": "Frejsi", [AUTH_HEADER]: authValue(auth) },
    signal,
    redirect: "manual",
  });
}

/** A Map whose mutators throw, so the allow-list cannot grow at runtime. */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const refuse = () => {
    throw new TypeError("READ_ONLY_ENDPOINTS is frozen");
  };
  Object.defineProperties(map, {
    set: { value: refuse },
    delete: { value: refuse },
    clear: { value: refuse },
  });
  return Object.freeze(map);
}
