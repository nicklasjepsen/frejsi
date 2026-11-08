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
  share_target?: {
    action: string;
    method: string;
    enctype: string;
    params: {
      title?: string;
      text?: string;
      url?: string;
      files?: { name: string; accept: string[] }[];
    };
  };
}

describe("manifest.webmanifest (plan §6)", () => {
  const manifest = JSON.parse(read("manifest.webmanifest")) as Manifest;

  it("has a name, display standalone and a start_url", () => {
    expect(manifest.name).toBe("Nænsom");
    expect(manifest.short_name).toBe("Nænsom");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  it("declares the share target: POST /api/share as multipart with title, text, url and image files (v0.6.0 §6)", () => {
    expect(manifest.share_target).toEqual({
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/*"] }],
      },
    });
    // Outside the locale middleware: a POST to a page would be redirected and its body lost.
    expect(manifest.share_target?.action.startsWith("/api/")).toBe(true);
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
      location: { origin: "https://naensom.example", search },
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
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
    },
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
    url: `https://naensom.example${url}`,
    mode,
  });
  return {
    dispatch,
    get,
    store,
    puts,
    opened,
    deleted,
    evict: () => {
      store.clear();
    },
  };
}

const online = (request: FakeRequest) => Promise.resolve(new Response(`live ${request.url}`));

describe("sw.js (push only)", () => {
  it("has no fetch handler: a page load never waits for the worker to start (v0.7.7)", async () => {
    const worker = loadWorker(online);
    await worker.dispatch("install");
    for (const url of ["/", "/da/now", "/api/health", "/_next/static/chunks/app.js"]) {
      const mode = url.startsWith("/_next") || url.startsWith("/api") ? "no-cors" : "navigate";
      expect(await worker.dispatch("fetch", worker.get(url, mode)), url).toBeNull();
    }
    expect(read("sw.js")).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(worker.opened).toEqual([]);
    expect(worker.puts).toEqual([]);
  });

  it("drops the caches earlier builds kept for the offline page, and nothing else", async () => {
    const worker = loadWorker(online, {
      search: "?v=v0.7.7",
      existing: ["frejsi-shell-v0.7.6", "frejsi-shell-dev", "someone-elses-cache"],
    });
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.deleted).toEqual(["frejsi-shell-v0.7.6", "frejsi-shell-dev"]);
    expect(existsSync(path.join(publicDir, "offline.html"))).toBe(false);
  });
});
