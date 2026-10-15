import type { DexcomShareRegion } from "../../schemas/glucose";
import { ENDPOINTS, HOSTS } from "./protocol";

/** The slice of `fetch` the adapter uses; tests pass one that serves the fixtures. */
export type FetchLike = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Pick<Response, "ok" | "status" | "text">>;

/** The production `fetch`; this file is the only one under `shared/src/glucose/` that may call it (lint). */
export const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

const HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
  "user-agent": "Frejsi",
};

/**
 * Hard rule (CLAUDE.md): glucose sources are read-only. The Share API accepts writes with the same
 * publisher credential the adapter logs in with (uploading readings, creating or removing followers
 * and invitations, changing a follower's alert settings), any of which could show a follower wrong
 * numbers or silence a low alarm. This map is the whole set of calls Frejsi may make: a path is
 * sent only when it is listed here with the method given, so a write cannot be sent by mistake.
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
      `Dexcom Share: ${method} ${path} is not an allow-listed read; glucose sources are read-only (CLAUDE.md)`,
    );
    this.name = "ReadOnlyEndpointError";
  }
}

export interface ShareRequest {
  region: DexcomShareRegion;
  /** The exact service path, without a query string. */
  path: string;
  method: string;
  query?: URLSearchParams;
  body?: Record<string, string>;
  signal: AbortSignal;
}

/**
 * The one function that talks to the Share service. It refuses, before `fetch` is called, any
 * path and method pair that is not in `READ_ONLY_ENDPOINTS`; the path must match exactly, so a
 * query string, a trailing slash, a dot segment or a different case does not pass.
 */
export async function sendShareRequest(
  fetch: FetchLike,
  request: ShareRequest,
): Promise<Pick<Response, "ok" | "status" | "text">> {
  const { region, path, method, query, body, signal } = request;
  if (READ_ONLY_ENDPOINTS.get(path) !== method) throw new ReadOnlyEndpointError(method, path);
  const search = query && query.size > 0 ? `?${query.toString()}` : "";
  return fetch(`https://${HOSTS[region]}${path}${search}`, {
    method,
    headers: HEADERS,
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
