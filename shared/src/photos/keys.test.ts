import { describe, expect, it } from "vitest";
import { photoKey, parsePhotoKey } from "./keys";
import { MemoryPhotoStore } from "./memory";

describe("private photo keys and store contract", () => {
  it("round trips space, kind and id, with a fresh opaque suffix", () => {
    const key = photoKey("space-fiction", "foods", "food-fiction");
    expect(parsePhotoKey(key)).toEqual({
      spaceId: "space-fiction",
      kind: "foods",
      id: "food-fiction",
    });
    expect(photoKey("space-fiction", "foods", "food-fiction")).not.toBe(key);
    expect(parsePhotoKey(photoKey("space-fiction", "meals", "meal-fiction"))?.kind).toBe("meals");
  });
  it("rejects traversal, encoded separators and foreign key shapes", () => {
    for (const id of ["../other", "a/b", "a%2fb", "", "a\\b"]) {
      expect(() => photoKey(id, "foods", "food-fiction")).toThrow();
    }
    for (const key of [
      "spaces/a/foods/b/../x",
      "spaces/a/foods/b/x/thumb.jpg",
      "spaces/a/other/b/x",
    ]) {
      expect(parsePhotoKey(key)).toBeNull();
    }
  });
  it("stores both sizes independently, copies bytes and deletes idempotently", async () => {
    const store = new MemoryPhotoStore();
    const key = photoKey("space-fiction", "foods", "food-fiction");
    const original = new Uint8Array([1, 2]);
    await store.put(key, { original, thumb: new Uint8Array([3]) });
    original[0] = 9;
    expect(store.photos.get(key)?.original).toEqual(new Uint8Array([1, 2]));
    expect(await store.readUrl(key, "thumb")).toContain("/thumb.jpg");
    expect(await store.readUrl(key, "original")).toContain("/original.jpg");
    await store.delete(key);
    await store.delete(key);
    expect(store.photos.size).toBe(0);
  });
});
