import { lookup as dnsLookup } from "node:dns/promises";
import { HttpError } from "../../schemas/api";

/** A recipe page is read whole; anything larger is not a recipe (plan §6). */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const PAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type ResolveHost = (hostname: string) => Promise<{ address: string }[]>;
export interface FetchPageOptions {
  fetch?: typeof globalThis.fetch;
  /** The DNS lookup the private-address check uses; the system resolver by default. */
  resolve?: ResolveHost;
  /** The one log line, with the outcome code only. Never the URL, its query or the page. */
  log?: (message: string, fields: { code: string }) => void;
  timeoutMs?: number;
}

const failed = (status = 502) => new HttpError(status, "recipe-fetch-failed");

/** Loopback, link-local, private and special ranges: a recipe never lives there. */
export function isPrivateAddress(value: string): boolean {
  const host = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    );
  }
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}
const systemResolve: ResolveHost = (hostname) => dnsLookup(hostname, { all: true });

/**
 * The host as written and every address it resolves to must be public. The check runs per hop,
 * right before the fetch; a resolver answer that changes between the check and the connection is
 * the one window left, which is why a recipe fetch never carries credentials and reads HTML only.
 */
async function assertPublic(url: URL, resolve: ResolveHost): Promise<void> {
  if (isPrivateAddress(url.hostname)) throw failed();
  if (/^[\d.]+$|^\[/.test(url.hostname)) return;
  let addresses: { address: string }[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw failed();
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw failed();
}

function allowed(value: string, origin?: URL): URL {
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    throw failed(400);
  }
  if (url.protocol !== "https:" || url.username || url.password || isPrivateAddress(url.hostname))
    throw failed(origin ? 502 : 400);
  if (origin && url.host !== origin.host) throw failed();
  return url;
}

async function readBounded(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) throw failed();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw failed();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/**
 * The HTML of a recipe page: https only, a public host (as written and as resolved), no
 * credentials, at most three redirects on the same host, 2 MB and 10 s. Runs only inside the
 * explicit parse request (the lint-boundaries test).
 * Every failure is `recipe-fetch-failed`; the log line carries the code and nothing of the URL.
 */
export async function fetchRecipePage(
  value: string,
  options: FetchPageOptions = {},
): Promise<string> {
  const fetch = options.fetch ?? globalThis.fetch;
  const resolve = options.resolve ?? systemResolve;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? PAGE_TIMEOUT_MS);
  try {
    let url = allowed(value);
    for (let hop = 0; ; hop++) {
      await assertPublic(url, resolve);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: "manual",
          credentials: "omit",
          headers: { "user-agent": "Frejsi", accept: "text/html" },
          signal: controller.signal,
        });
      } catch {
        throw failed();
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) throw failed();
        url = allowed(location, url);
        continue;
      }
      if (!response.ok) throw failed();
      const type = response.headers.get("content-type") ?? "";
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(type)) throw failed();
      if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) throw failed();
      return await readBounded(response.body);
    }
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "recipe-fetch-failed";
    options.log?.("recipe.fetch", { code });
    throw error instanceof HttpError ? error : failed();
  } finally {
    clearTimeout(timer);
  }
}
