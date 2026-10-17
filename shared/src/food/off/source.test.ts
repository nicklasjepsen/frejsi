import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { FoodCandidate } from "../../schemas/food";
import { mapProduct } from "./map";
import { OffSource } from "./source";
import { OffRateLimits } from "./rate-limit";

const signal = () => new AbortController().signal;
async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../../../fixtures/open-food-facts/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}
function fake(names: string[], status = 200) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input.toString()), init });
    const name = names[Math.min(calls.length - 1, names.length - 1)] ?? "search-empty";
    return Response.json(await fixture(name), { status });
  };
  return { fetcher, calls };
}
function source(fetcher: typeof fetch, limits = new OffRateLimits()) {
  return new OffSource({ fetch: fetcher, country: "dk", version: "test", locale: "da", limits });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OFF fixture adapter", () => {
  it("maps a barcode, locale, brand, carbs and serving to a strict unverified candidate", async () => {
    const f = fake(["product-found"]);
    const result = await source(f.fetcher).byBarcode("2000000000008", signal());
    expect(result).toEqual({
      status: "ok",
      candidates: [
        {
          origin: "off",
          sourceRef: "off:2000000000008",
          barcode: "2000000000008",
          name: "Fiktivt rugbrød, Fiktiv Bageri",
          carbsPer100g: 40,
          portions: [{ label: "1 slice (45 g)", grams: 45, carbs: 18 }],
        },
      ],
    });
    expect(f.calls[0]?.url.pathname).toBe("/api/v2/product/2000000000008.json");
    expect(new Headers(f.calls[0]?.init?.headers).get("User-Agent")).toBe(
      "Frejsi/test (+https://github.com/nicklasjepsen/frejsi)",
    );
    for (const candidate of result.candidates) {
      expect(FoodCandidate.parse(candidate)).toEqual(candidate);
      expect(candidate).not.toHaveProperty("verified");
    }
    expectTypeOf<Extract<keyof FoodCandidate, "verified">>().toEqualTypeOf<never>();
  });
  it("requests categories_tags and maps the most specific known tag; fixtures without tags map without a category (plan §7)", async () => {
    const f = fake(["product-with-categories"]);
    const result = await source(f.fetcher).byBarcode("2000000000039", signal());
    expect(f.calls[0]?.url.searchParams.get("fields")?.split(",")).toContain("categories_tags");
    expect(result.candidates).toEqual([
      {
        origin: "off",
        sourceRef: "off:2000000000039",
        barcode: "2000000000039",
        name: "Fiktivt kernerugbrød, Fiktiv Bageri",
        carbsPer100g: 38.2,
        portions: [{ label: "1 slice (50 g)", grams: 50, carbs: 19 }],
        category: "bread",
      },
    ]);
    const tagged = (await fixture("product-with-categories")) as { product: object };
    expect(
      mapProduct({ ...tagged.product, categories_tags: ["en:plant-based-foods"] }, "da"),
    ).not.toHaveProperty("category");
    expect(
      mapProduct({ ...tagged.product, categories_tags: ["en:breads", "en:sandwiches"] }, "da")
        ?.category,
    ).toBe("mixed");
    expect(
      mapProduct({ ...tagged.product, categories_tags: "en:breads" }, "da"),
    ).not.toHaveProperty("category");
    const plain = (await fixture("product-found")) as { product: object };
    expect(mapProduct(plain.product, "da")).not.toHaveProperty("category");
    const search = (await fixture("search-results")) as { products: object[] };
    for (const product of search.products)
      expect(mapProduct(product, "da")).not.toHaveProperty("category");
    const text = fake(["search-results"]);
    await source(text.fetcher).search("rugbrød", "da", signal());
    expect(text.calls[0]?.url.searchParams.get("fields")?.split(",")).toContain("categories_tags");
  });
  it("keeps missing carbs null without a portion, and missing products are ok", async () => {
    const f = fake(["product-no-carbs", "product-not-found"]);
    const off = source(f.fetcher);
    expect((await off.byBarcode("2000000000015", signal())).candidates[0]).toMatchObject({
      name: "Fictional bread, Imaginary Bakery",
      carbsPer100g: null,
      portions: [],
    });
    expect(await off.byBarcode("2000000000022", signal())).toEqual({
      status: "ok",
      candidates: [],
    });
  });
  it("searches country first, fills from world, deduplicates and uses the requested language", async () => {
    const f = fake(["search-results", "search-results"]);
    const result = await source(f.fetcher).search("rugbrød", "en", signal());
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.name).toBe("Fictional rye bread, Fiktiv Bageri");
    expect(f.calls.map((c) => c.url.host)).toEqual([
      "dk.openfoodfacts.org",
      "world.openfoodfacts.org",
    ]);
    for (const call of f.calls) {
      expect(call.url.pathname).toBe("/cgi/search.pl");
      expect(Object.fromEntries(call.url.searchParams)).toMatchObject({
        search_terms: "rugbrød",
        json: "1",
        page_size: "10",
        search_simple: "1",
        action: "process",
      });
      expect(call.url.searchParams.get("fields")).toContain("product_name_en");
      expect(new Headers(call.init?.headers).get("User-Agent")).toContain("Frejsi/test");
    }
    for (const candidate of result.candidates)
      expect(FoodCandidate.parse(candidate)).not.toHaveProperty("verified");
  });
  it("keeps country priority and caps at ten; five country results skip world", async () => {
    const template = (await fixture("search-results")) as { products: unknown[] };
    // Use valid checksums for the twelve fictional codes.
    const { normaliseBarcode } = await import("../barcode");
    const codes = Array.from(
      { length: 12 },
      (_, i) => `200000000${String(i).padStart(3, "0")}`,
    ).map((prefix) =>
      Array.from({ length: 10 }, (_, n) => `${prefix}${n}`).find((code) => normaliseBarcode(code)),
    );
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          products: codes.map((code) => ({ ...(template.products[0] as object), code })),
        }),
      ),
    );
    const result = await source(fetcher).search("bread", "en", signal());
    expect(result.candidates).toHaveLength(10);
    expect(result.candidates.map((c) => c.barcode)).toEqual(codes.slice(0, 10));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("shares network budgets across instances, counts fallback requests and refills", async () => {
    const f = fake(["search-empty"]);
    const limits = new OffRateLimits();
    const a = source(f.fetcher, limits),
      b = source(f.fetcher, limits);
    for (let i = 0; i < 5; i++) expect((await a.search("bread", "en", signal())).status).toBe("ok");
    expect((await b.search("bread", "en", signal())).status).toBe("rate-limited");
    expect(f.calls).toHaveLength(10);
    vi.advanceTimersByTime(60_000);
    expect((await b.search("bread", "en", signal())).status).toBe("ok");
  });
  it("retains country matches when the optional world fallback fails or has no budget", async () => {
    const country = await fixture("search-results");
    for (const reason of ["network", "budget"] as const) {
      const limits = new OffRateLimits();
      if (reason === "budget") for (let i = 0; i < 9; i++) limits.search.take();
      const fetcher: typeof fetch = (url) => {
        if (
          new URL(url instanceof Request ? url.url : url.toString()).hostname ===
          "world.openfoodfacts.org"
        )
          return Promise.reject(new Error("offline"));
        return Promise.resolve(Response.json(country));
      };
      const result = await source(fetcher, limits).search("bread", "en", signal());
      expect(result.status).toBe("ok");
      expect(result.candidates.map((candidate) => candidate.sourceRef)).toEqual([
        "off:2000000000008",
        "off:2000000000015",
      ]);
    }
  });
  it("bounds product reads independently of searches", async () => {
    const f = fake(["product-not-found"]);
    const off = source(f.fetcher);
    for (let i = 0; i < 15; i++)
      expect((await off.byBarcode("2000000000008", signal())).status).toBe("ok");
    expect((await off.byBarcode("2000000000008", signal())).status).toBe("rate-limited");
    expect(f.calls).toHaveLength(15);
  });
  it("handles 429, failures, malformed replies and cancellation without leaking data", async () => {
    const limited = fake(["rate-limited"], 429);
    expect((await source(limited.fetcher).search("bread", "en", signal())).status).toBe(
      "rate-limited",
    );
    expect(limited.calls).toHaveLength(1);
    const failed: typeof fetch = () => Promise.reject(new Error("offline"));
    expect((await source(failed).search("bread", "en", signal())).status).toBe("error");
    const malformed: typeof fetch = () => Promise.resolve(Response.json({ products: "invalid" }));
    expect((await source(malformed).search("bread", "en", signal())).status).toBe("error");
    const abort = new AbortController();
    abort.abort();
    const f = fake(["search-results"]);
    expect((await source(f.fetcher).search("bread", "en", abort.signal)).status).toBe("timeout");
    expect(f.calls).toHaveLength(0);
    const pending: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        expect(init?.signal).toBe(abortDuring.signal);
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    const abortDuring = new AbortController();
    const result = source(pending).search("bread", "en", abortDuring.signal);
    abortDuring.abort();
    expect((await result).status).toBe("timeout");
  });
});
