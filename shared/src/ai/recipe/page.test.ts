import { describe, expect, it, vi } from "vitest";
import { fetchRecipePage, MAX_PAGE_BYTES, PAGE_TIMEOUT_MS } from "./page";

type Fetch = typeof globalThis.fetch;
const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("fetchRecipePage (https only, 2 MB and 10 s caps, no redirects off the host)", () => {
  it("fetches an https page once with the Frejsi user agent, no credentials and manual redirects", async () => {
    const fetch = vi.fn<Fetch>(() => Promise.resolve(html("<p>fictional</p>")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne?print=1", { fetch }),
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
      "https://user:pw@recipes.example/x",
    ])
      await expect(fetchRecipePage(url, { fetch }), url).rejects.toMatchObject({
        status: 400,
        code: "recipe-fetch-failed",
      });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("follows at most three redirects on the same host and refuses one to another host", async () => {
    const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
    const same = vi.fn<Fetch>(() => Promise.resolve(html("<p>moved</p>")));
    same.mockResolvedValueOnce(redirect("/lasagne-2"));
    await expect(fetchRecipePage("https://recipes.example/lasagne", { fetch: same })).resolves.toBe(
      "<p>moved</p>",
    );
    expect((same.mock.calls[1]?.[0] as URL).href).toBe("https://recipes.example/lasagne-2");
    const other = vi.fn<Fetch>(() => Promise.resolve(redirect("https://elsewhere.example/x")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne", { fetch: other }),
    ).rejects.toMatchObject({ status: 502, code: "recipe-fetch-failed" });
    expect(other).toHaveBeenCalledTimes(1);
    const loop = vi.fn<Fetch>(() => Promise.resolve(redirect("/again")));
    await expect(
      fetchRecipePage("https://recipes.example/lasagne", { fetch: loop }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("refuses a non-2xx answer, a non-HTML body and a response over 2 MB, declared or streamed", async () => {
    const notFound = vi.fn<Fetch>(() => Promise.resolve(new Response("gone", { status: 404 })));
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: notFound }),
    ).rejects.toMatchObject({ status: 502, code: "recipe-fetch-failed" });
    const pdf = vi.fn<Fetch>(() =>
      Promise.resolve(new Response("%PDF", { headers: { "content-type": "application/pdf" } })),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: pdf }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    const declared = vi.fn<Fetch>(() =>
      Promise.resolve(
        new Response("<p>x</p>", {
          headers: { "content-type": "text/html", "content-length": String(MAX_PAGE_BYTES + 1) },
        }),
      ),
    );
    await expect(
      fetchRecipePage("https://recipes.example/x", { fetch: declared }),
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
      fetchRecipePage("https://recipes.example/x", { fetch: streamed }),
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
      const pending = fetchRecipePage("https://recipes.example/slow", { fetch: slow });
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
      fetchRecipePage("https://recipes.example/secret-path?token=abc", { fetch, log }),
    ).rejects.toMatchObject({ code: "recipe-fetch-failed" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("recipe-fetch-failed");
    expect(lines.join("\n")).not.toMatch(/recipes\.example|secret-path|token|abc|network/);
  });
  it("exposes the caps the plan names", () => {
    expect(MAX_PAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(PAGE_TIMEOUT_MS).toBe(10_000);
  });
});
