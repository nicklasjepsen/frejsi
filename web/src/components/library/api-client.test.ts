import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { libraryApi, LibraryApiError, lookupVerifiedFoods } from "./api-client";
import { artboardFoods } from "./test-support";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const sent = (index = 0) => {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error("no call");
  const [input, init = {}] = call;
  return {
    url: typeof input === "string" ? input : "",
    init,
    json: () => JSON.parse(init.body as string) as unknown,
  };
};

describe("libraryApi", () => {
  it("lists with the filter and a trimmed query, and accepts { foods, counts } or a bare array", async () => {
    const foods = artboardFoods();
    fetchMock.mockResolvedValueOnce(reply(200, { foods, counts: { all: 5, unverified: 3 } }));
    await expect(libraryApi.list("s 1", { filter: "unverified", q: " rug " })).resolves.toEqual({
      foods,
      counts: { all: 5, unverified: 3 },
    });
    expect(sent().url).toBe("/api/spaces/s%201/foods?filter=unverified&q=rug");
    fetchMock.mockResolvedValueOnce(reply(200, foods));
    await expect(libraryApi.list("s1", { filter: "all", q: "" })).resolves.toEqual({
      foods,
      counts: undefined,
    });
    expect(sent(1).url).toBe("/api/spaces/s1/foods?filter=all");
  });

  it("creates from the library without ever sending verified; verify: true is the explicit tick", async () => {
    const [food] = artboardFoods();
    fetchMock.mockImplementation(() => Promise.resolve(reply(201, food)));
    const fields = { name: "Fictional bread", carbsPer100g: 40, portions: [] };
    await libraryApi.create("s1", fields, { verify: false });
    await libraryApi.create("s1", fields, { verify: true });
    const first = sent(0).json() as Record<string, unknown>;
    const second = sent(1).json() as Record<string, unknown>;
    expect(first).toEqual({ ...fields, from: "library" });
    expect(second).toEqual({ ...fields, from: "library", verify: true });
    expect("verified" in first || "verified" in second).toBe(false);
  });

  it("verifies through POST foods/verify and uploads a photo as JPEG bytes", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await libraryApi.verify("s1", ["f1", "f2"]);
    expect(sent().url).toBe("/api/spaces/s1/foods/verify");
    expect(sent().init.method).toBe("POST");
    expect(sent().json()).toEqual({ foodIds: ["f1", "f2"] });

    fetchMock.mockResolvedValueOnce(reply(200, artboardFoods()[0]));
    await expect(libraryApi.putPhoto("s1", "f-rye", new Uint8Array([1, 2]))).resolves.toMatchObject(
      { id: "f-rye" },
    );
    expect(sent(1).url).toBe("/api/spaces/s1/foods/f-rye/photo");
    expect(sent(1).init.method).toBe("PUT");
    expect(sent(1).init.headers).toMatchObject({ "content-type": "image/jpeg" });
  });

  it("splits a batch over 50 into requests the contract accepts", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply(200, {})));
    const ids = Array.from({ length: 51 }, (_, index) => `f${String(index)}`);
    await libraryApi.verify("s1", ids);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent(0).json()).toEqual({ foodIds: ids.slice(0, 50) });
    expect(sent(1).json()).toEqual({ foodIds: ["f50"] });
  });

  it("turns an error response into its ApiError code, and a gateway page into internal", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, { error: { code: "simple-mode", message: "simple-mode" } }),
    );
    await expect(libraryApi.verify("s1", ["f1"])).rejects.toEqual(
      new LibraryApiError(400, "simple-mode"),
    );
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(libraryApi.get("s1", "f1")).rejects.toMatchObject({ code: "internal" });
  });
});

it("the simple-picker adapter submits once and returns only verified library foods with portions", async () => {
  const base = artboardFoods()[0];
  if (!base) throw new Error("Missing fixture");
  const match = {
    ...base,
    id: "pasta",
    name: "Pasta med kødsovs",
    verified: true,
    portions: [{ label: "1 plate", carbs: 50 }],
  };
  const unchecked = { ...match, id: "unchecked", verified: false };
  const weighed = { ...match, id: "weighed", portions: [] };
  fetchMock.mockResolvedValueOnce(
    reply(200, {
      results: [
        { source: "library", food: match, verified: true },
        { source: "library", food: unchecked, verified: false },
        { source: "library", food: weighed, verified: true },
        {
          source: "cache",
          food: {
            name: "Cached pasta",
            origin: "remote-test",
            sourceRef: "remote-test:pasta",
            carbsPer100g: 20,
            portions: [],
          },
          verified: false,
        },
      ],
      sources: { semantic: "ok" },
      manual: { name: "spagetti" },
    }),
  );
  expect(await lookupVerifiedFoods("s 1", " spagetti ")).toEqual([match]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sent().url).toBe("/api/spaces/s%201/lookup?q=spagetti&remote=true");
  expect(await lookupVerifiedFoods("s1", "sp")).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
