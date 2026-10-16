import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FoodCorrection } from "../../schemas/food";
import { OffContributor } from "./contribute";
import { OffRateLimits } from "./rate-limit";

const USER = "fiktiv-bruger";
const PASSWORD = "hemmelig-fiktiv-kode";
const correction: FoodCorrection = {
  barcode: "2000000000008",
  carbsPer100g: 40,
  servingSize: { grams: 45 },
  appRef: "0123456789abcdef0123456789abcdef",
};
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected a recorded call");
  return item;
}
const signal = () => new AbortController().signal;
async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      new URL(`../../../../fixtures/open-food-facts/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}
function recording(name: string, status = 200) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({
      url: new URL(input instanceof Request ? input.url : input.toString()),
      init: init ?? {},
    });
    return Response.json(await fixture(name), { status });
  };
  return { fetcher, calls };
}
function contributor(
  fetcher: typeof fetch,
  extra: Partial<ConstructorParameters<typeof OffContributor>[0]> = {},
) {
  return new OffContributor({
    fetch: fetcher,
    user: USER,
    password: PASSWORD,
    version: "1.2.3",
    limits: new OffRateLimits(),
    ...extra,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OffContributor request", () => {
  it("sends one form-encoded POST with every field and no product name", async () => {
    const f = recording("write-ok");
    const result = await contributor(f.fetcher).contribute(correction, signal());
    expect(result).toEqual({ status: "ok" });
    expect(f.calls).toHaveLength(1);
    const { url, init } = first(f.calls);
    expect(url.pathname).toBe("/cgi/product_jqm2.pl");
    expect(url.protocol).toBe("https:");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("user-agent")).toBe(
      "Frejsi/1.2.3 (+https://github.com/nicklasjepsen/frejsi)",
    );
    expect(headers.has("authorization")).toBe(false);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      code: "2000000000008",
      user_id: USER,
      password: PASSWORD,
      app_name: "Frejsi",
      app_version: "1.2.3",
      app_uuid: correction.appRef,
      nutrition_data_per: "100g",
      nutriment_carbohydrates: "40",
      nutriment_carbohydrates_unit: "g",
      serving_size: "45 g",
      comment: "Correction from Frejsi",
    });
    expect(body.has("product_name")).toBe(false);
  });

  it("omits the carbohydrate and serving fields that were not corrected", async () => {
    const f = recording("write-ok");
    await contributor(f.fetcher).contribute({ barcode: "2000000000008", appRef: "a" }, signal());
    const body = new URLSearchParams(first(f.calls).init.body as string);
    expect([...body.keys()]).not.toContain("nutriment_carbohydrates");
    expect([...body.keys()]).not.toContain("serving_size");
    expect([...body.keys()]).not.toContain("nutrition_data_per");
  });

  it("uses the configured host and adds basic authentication on the staging host only", async () => {
    const staging = recording("write-ok");
    await contributor(staging.fetcher, { host: "world.openfoodfacts.net" }).contribute(
      correction,
      signal(),
    );
    expect(first(staging.calls).url.host).toBe("world.openfoodfacts.net");
    expect(new Headers(first(staging.calls).init.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("off:off").toString("base64")}`,
    );
    const other = recording("write-ok");
    await contributor(other.fetcher, { host: "off.example.test" }).contribute(correction, signal());
    expect(first(other.calls).url.host).toBe("off.example.test");
    expect(new Headers(first(other.calls).init.headers).has("authorization")).toBe(false);
  });
});

describe("OffContributor results", () => {
  it.each([
    ["write-ok", 200, "ok"],
    ["write-not-logged-in", 200, "bad-credentials"],
    ["write-rejected", 200, "rejected"],
    ["write-rate-limited", 429, "rate-limited"],
    ["write-ok", 500, "error"],
  ])("%s with HTTP %i is %s", async (name, status, expected) => {
    const f = recording(name, status);
    expect(await contributor(f.fetcher).contribute(correction, signal())).toEqual({
      status: expected,
    });
  });

  it("is error for a network failure, an unreadable body and an invalid correction", async () => {
    const down: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
    expect(await contributor(down).contribute(correction, signal())).toEqual({ status: "error" });
    const html: typeof fetch = () => Promise.resolve(new Response("<html>", { status: 200 }));
    expect(await contributor(html).contribute(correction, signal())).toEqual({ status: "error" });
    const f = recording("write-ok");
    expect(
      await contributor(f.fetcher).contribute(
        { ...correction, barcode: "2000000000009" },
        signal(),
      ),
    ).toEqual({ status: "error" });
    expect(f.calls).toHaveLength(0);
  });

  it("is error after the 10 second timeout", async () => {
    const hangs: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const pending = contributor(hangs).contribute(correction, signal());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: "error" });
  });

  it("honours the caller's AbortSignal", async () => {
    const f = recording("write-ok");
    const aborted = AbortSignal.abort();
    expect(await contributor(f.fetcher).contribute(correction, aborted)).toEqual({
      status: "error",
    });
    expect(f.calls).toHaveLength(0);

    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const hangs: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        seen = init?.signal ?? undefined;
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const pending = contributor(hangs).contribute(correction, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: "error" });
    expect(seen?.aborted).toBe(true);
  });
});

describe("OffContributor limits and secrecy", () => {
  it("answers rate-limited without a call for the 11th write within a minute", async () => {
    const f = recording("write-ok");
    const c = contributor(f.fetcher);
    for (let i = 0; i < 10; i++)
      expect((await c.contribute(correction, signal())).status).toBe("ok");
    expect(await c.contribute(correction, signal())).toEqual({ status: "rate-limited" });
    expect(f.calls).toHaveLength(10);
    vi.advanceTimersByTime(60_000);
    expect((await c.contribute(correction, signal())).status).toBe("ok");
  });

  it("puts neither the password nor the barcode in any log line, error or thrown value", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const failing: typeof fetch = () =>
      Promise.reject(new Error(`boom ${PASSWORD} ${correction.barcode}`));
    const outcomes: unknown[] = [];
    for (const fetcher of [
      failing,
      recording("write-not-logged-in").fetcher,
      recording("write-rejected").fetcher,
    ]) {
      try {
        outcomes.push(await contributor(fetcher).contribute(correction, signal()));
      } catch (error) {
        outcomes.push(error);
      }
    }
    const written = [
      ...spies.flatMap((s) => s.mock.calls),
      ...stdout.mock.calls,
      ...stderr.mock.calls,
    ];
    const text = JSON.stringify([written, outcomes, outcomes.map(String)]);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(correction.barcode);
    expect(text).not.toContain(USER);
  });
});
