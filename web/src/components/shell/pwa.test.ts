import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const publicDir = path.resolve(import.meta.dirname, "../../../public");
const read = (file: string) => readFileSync(path.join(publicDir, file), "utf8");

interface Manifest {
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

describe("manifest.webmanifest (plan §6)", () => {
  const manifest = JSON.parse(read("manifest.webmanifest")) as Manifest;

  it("has a name, display standalone and a start_url", () => {
    expect(manifest.name).toBe("Frejsi");
    expect(manifest.short_name).toBe("Frejsi");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  it("is Danish-first: lang da and a Danish description for the install prompt", () => {
    expect(manifest.lang).toBe("da");
    expect(manifest.description).toMatch(/\S/);
    // The manifest carries one language; the description must be in the declared one.
    expect(manifest.description).not.toMatch(/\b(and|the|with|people)\b/);
    expect(manifest.description).toMatch(/diabetes/);
  });

  it("lists 192 and 512 px icons that exist, one of them maskable", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(existsSync(path.join(publicDir, icon.src)), icon.src).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });
});

/** A fake request: the worker reads method, url and mode only. */
interface FakeRequest {
  method: string;
  url: string;
  mode: string;
}

/**
 * Runs sw.js in a sandbox with a fake cache and fetch, and returns its event listeners. `search` is
 * the registration URL's query (`?v=<version>`); `existing` the cache names already on the device.
 */
function loadWorker(
  fetchImpl: (request: FakeRequest) => Promise<Response>,
  { search = "", existing = [] as string[] } = {},
) {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const opened: string[] = [];
  const deleted: string[] = [];
  const cache = {
    addAll: (urls: string[]) => {
      for (const url of urls) store.set(url, new Response(`cached ${url}`));
      return Promise.resolve();
    },
    put: (request: FakeRequest | string, response: Response) => {
      const key = typeof request === "string" ? request : new URL(request.url).pathname;
      puts.push(key);
      store.set(key, response);
      return Promise.resolve();
    },
    match: (request: FakeRequest | string) => {
      const key = typeof request === "string" ? request : new URL(request.url).pathname;
      // A real cache hands out a fresh body each time.
      return Promise.resolve(store.get(key)?.clone());
    },
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const sandbox = {
    self: {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        listeners.set(type, fn);
      },
      skipWaiting: () => undefined,
      clients: { claim: () => Promise.resolve() },
      location: { origin: "https://frejsi.example", search },
    },
    caches: {
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve(cache);
      },
      match: (request: FakeRequest | string) => cache.match(request),
      keys: () => Promise.resolve(existing),
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    },
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    Response,
    Promise,
  };
  vm.runInNewContext(read("sw.js"), sandbox);
  const dispatch = async (type: "install" | "activate" | "fetch", request?: FakeRequest) => {
    const captured: { response?: Promise<Response | undefined>; wait?: Promise<unknown> } = {};
    listeners.get(type)?.({
      request,
      respondWith: (p: Promise<Response | undefined>) => {
        captured.response = p;
      },
      waitUntil: (p: Promise<unknown>) => {
        captured.wait = p;
      },
    });
    await captured.wait;
    return captured.response ? await captured.response : null;
  };
  const get = (url: string, mode = "no-cors"): FakeRequest => ({
    method: "GET",
    url: `https://frejsi.example${url}`,
    mode,
  });
  return { dispatch, get, store, puts, opened, deleted };
}

const online = (request: FakeRequest) => Promise.resolve(new Response(`live ${request.url}`));
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("sw.js (the offline shell)", () => {
  const sw = read("sw.js");
  const match = /const PRECACHE = (\[[^\]]*\])/.exec(sw);
  // The source is prettier-formatted: a trailing comma that JSON does not take.
  const precache = JSON.parse((match?.[1] ?? "[]").replace(/,\s*\]$/, "]")) as string[];

  it("precaches the offline page, the manifest and the icons, and no page that carries a person's data", () => {
    expect(precache).toContain("/offline.html");
    expect(precache).toContain("/manifest.webmanifest");
    expect(precache).toContain("/icons/icon-192.png");
    expect(precache).toContain("/icons/icon-512.png");
    expect(existsSync(path.join(publicDir, "offline.html"))).toBe(true);
    expect(precache.some((route) => /^\/(da|en)(\/|$)/.test(route))).toBe(false);
    expect(precache.some((route) => route.startsWith("/api"))).toBe(false);
  });

  it("never touches the API, so a glucose value is never served from a cache", async () => {
    const worker = loadWorker(online);
    await worker.dispatch("install");
    const response = await worker.dispatch("fetch", worker.get("/api/health"));
    expect(response).toBeNull();
    expect(worker.puts).toEqual([]);
    expect(worker.store.has("/api/health")).toBe(false);
  });

  it("serves pages from the network and stores none of them: a signed-in page never outlives its session", async () => {
    const worker = loadWorker(online);
    await worker.dispatch("install");
    const response = await worker.dispatch("fetch", worker.get("/da/now", "navigate"));
    expect(await response?.text()).toBe("live https://frejsi.example/da/now");
    expect(worker.puts).toEqual([]);
    expect(worker.store.has("/da/now")).toBe(false);
  });

  it("shows the offline page for any navigation while offline, the installed app's start URL included", async () => {
    const worker = loadWorker(offline);
    await worker.dispatch("install");
    for (const url of ["/", "/da", "/da/now", "/en/soon/meals"]) {
      const response = await worker.dispatch("fetch", worker.get(url, "navigate"));
      expect(await response?.text(), url).toBe("cached /offline.html");
    }
  });

  it("caches Next's hashed static assets on first use and serves them from the cache after", async () => {
    let calls = 0;
    const worker = loadWorker((request) => {
      calls += 1;
      return online(request);
    });
    await worker.dispatch("install");
    const asset = worker.get("/_next/static/chunks/app.js");
    const first = await worker.dispatch("fetch", asset);
    expect(await first?.text()).toContain("live");
    await Promise.resolve();
    expect(worker.puts).toEqual(["/_next/static/chunks/app.js"]);
    const second = await worker.dispatch("fetch", asset);
    expect(second).toBeDefined();
    expect(calls).toBe(1);
  });

  it("names its cache after the build version in the registration URL, and drops the other builds' caches", async () => {
    const worker = loadWorker(online, {
      search: "?v=v0.5.1",
      existing: ["frejsi-shell-v2", "frejsi-shell-v0.5.0", "frejsi-shell-v0.5.1"],
    });
    await worker.dispatch("install");
    expect(worker.opened).toEqual(["frejsi-shell-v0.5.1"]);
    await worker.dispatch("activate");
    expect(worker.deleted).toEqual(["frejsi-shell-v2", "frejsi-shell-v0.5.0"]);
  });

  it("falls back to a dev cache name without a version", async () => {
    const worker = loadWorker(online);
    await worker.dispatch("install");
    expect(worker.opened).toEqual(["frejsi-shell-dev"]);
  });

  it("leaves other origins and non-GET requests to the browser", async () => {
    const worker = loadWorker(online);
    await worker.dispatch("install");
    expect(
      await worker.dispatch("fetch", {
        method: "GET",
        url: "https://fonts.example/x.woff2",
        mode: "cors",
      }),
    ).toBeNull();
    expect(
      await worker.dispatch("fetch", {
        method: "POST",
        url: "https://frejsi.example/da/now",
        mode: "navigate",
      }),
    ).toBeNull();
  });
});
