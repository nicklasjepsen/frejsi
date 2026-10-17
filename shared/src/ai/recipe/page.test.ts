import { describe, expect, it, vi } from "vitest";
import { fetchRecipePage, isPrivateAddress, MAX_PAGE_BYTES, PAGE_TIMEOUT_MS } from "./page";

type Fetch = typeof globalThis.fetch;
const publicHost = () => Promise.resolve([{ address: "203.0.113.10" }]);
const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("fetchRecipePage (https only, 2 MB and 10 s caps, no redirects off the host)", () => {
  it("fetches an https page once with the Frejsi user agent, no credentials and manual redirects", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(html("<p>fictional</p>")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne?print=1", { fetch, resolve: publicHost }),
    ).resolves.toBe("<p>fictional</p>");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe("https://recipes.example/lasagne?print=1");
    expect(init).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      headers: { "user-agent": "Frejsi", accept: "text/html" },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("refuses http://, a non-URL, and a local or private host without fetching", async () => {
    const fetch = vi.fn<Fetch>();
    for (const url of [
      "http://recipes.example/lasagne",
      "ftp://recipes.example/x",
      "not a url",
      "https://localhost/recipe",
      "https://127.0.0.1/recipe",
      "https://10.0.0.5/recipe",
      "https://192.168.1.2/recipe",
      "https://[::1]/recipe",
      "https://[::ffff:127.0.0.1]/recipe",
      "https://[::ffff:7f00:1]/recipe",
      "https://[::ffff:a00:1]/recipe",
      "https://[64:ff9b::a00:1]/recipe",
      "https://[0:0:0:0:0:ffff:c0a8:101]/recipe",
      "https://user:pw@recipes.example/x",
    ])
      await expect(fetchRecipePage(url, { fetch, resolve: publicHost }), url).rejects.toMatchObject(
        {
          status: 400,
          code: "recipe-fetch-failed",
        },
      );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("follows at most three redirects on the same host and refuses one to another host", async () => {
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    const same = vi.fn<Fetch>(() => Promise.resolve(html("<p>moved</p>")));
    same.mockResolvedValueOnce(redirect("/lasagne-2"));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne", { fetch: same, resolve: publicHost }),
    ).resolves.toBe("<p>moved</p>");
    expect((same.mock.calls[1]?.[0] as URL).href).toBe("https://recipes.example/lasagne-2");
    const other = vi.fn<Fetch>(() => Promise.resolve(redirect("https://elsewhere.example/x")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne", { fetch: other, resolve: publicHost }),
    ).rejects.toMatchObject({ status: 502, code: "recipe-fetch-failed" });
    expect(other).toHaveBeenCalledTimes(1);
    const loop = vi.fn<Fetch>(() => Promise.resolve(redirect("/again")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne", { fetch: loop, resolve: publicHost }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("refuses a non-2xx answer, a non-HTML body and a response over 2 MB, declared or streamed", async () => {
    const notFound = vi.fn<Fetch>(() => Promise.resolve(new Response("gone", { status: 404 })));
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: notFound, resolve: publicHost }),
    ).rejects.toMatchObject({ status: 502, code: "recipe-fetch-failed" });
    const pdf = vi.fn<Fetch>(() =>
      Promise.resolve(new Response("%PDF", { headers: { "content-type": "application/pdf" } })),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: pdf, resolve: publicHost }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    const declared = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response("<p>x</p>", {
          headers: { "content-type": "text/html", "content-length": String(MAX_PAGE_BYTES + 1) },
        }),
      ),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: declared, resolve: publicHost }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    const chunk = new TextEncoder().encode("<p>".padEnd(64 * 1024, "x"));
    let served = 0;
    const streamed = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              served += chunk.byteLength;
              controller.enqueue(chunk);
              if (served > MAX_PAGE_BYTES * 2) controller.close();
            },
          }),
          { headers: { "content-type": "text/html" } },
        ),
      ),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: streamed, resolve: publicHost }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(served).toBeLessThan(MAX_PAGE_BYTES * 2);
  });
  it("gives up after the timeout, aborting the request", async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const slow = vi.fn<Fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const pending = fetchRecipePage("https://recipes.example/slow", {
        fetch: slow,
        resolve: publicHost,
      });
      const outcome = expect(pending).rejects.toMatchObject({ code: "recipe-fetch-failed" });
      await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS + 1);
      await outcome;
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("logs the outcome code only: never the URL, its query or the page", async () => {
    const lines: string[] = [];
    const log = (message: string, fields: Record<string, unknown>) => {
      lines.push(JSON.stringify({ message, ...fields }));
    };
    const fetch = vi.fn<Fetch>(() => Promise.reject(new TypeError("network")));
    await expect(
      fetchRecipePage("https://recipes.example/secret-path?token=abc", {
        fetch,
        log,
        resolve: publicHost,
      }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("recipe-fetch-failed");
    expect(lines.join("\n")).not.toMatch(/recipes\.example|secret-path|token|abc|network/);
  });
  it("refuses a public-looking host that resolves to a private or special address, before fetching", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(html("<p>never</p>")));
    for (const address of [
      "10.0.0.5",
      "127.0.0.1",
      "169.254.169.254",
      "192.168.1.9",
      "172.16.0.1",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:10.1.1.1",
      "224.0.0.1",
    ]) {
      const resolve = () => Promise.resolve([{ address: "203.0.113.10" }, { address }]);
      await expect(
        fetchRecipePage("https://recipes.example/x", { fetch, resolve }),
        address,
      ).rejects.toMatchObject({ status: 502, code: "recipe-fetch-failed" });
    }
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch, resolve: () => Promise.resolve([]) }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    await expect(
      fetchRecipePage("https://recipes.example/x", {
        fetch,
        resolve: () => Promise.reject(new Error("ENOTFOUND")),
      }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(fetch).not.toHaveBeenCalled();
    // A redirect's host is resolved and checked too.
    const resolve = vi.fn((host: string) =>
      Promise.resolve([{ address: host === "recipes.example" ? "203.0.113.10" : "10.0.0.5" }]),
    );
    const next = vi.fn<Fetch>(() => Promise.resolve(html("<p>ok</p>")));
    next.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://recipes.example/next" } }),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: next, resolve }),
    ).resolves.toBe("<p>ok</p>");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(isPrivateAddress("203.0.113.10")).toBe(false);
    expect(isPrivateAddress("2001:db8::1")).toBe(false);
    expect(isPrivateAddress("::ffff:cb00:710a")).toBe(false);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
  });
  it("exposes the caps the plan names", () => {
    expect(MAX_PAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(PAGE_TIMEOUT_MS).toBe(10_000);
  });
});
