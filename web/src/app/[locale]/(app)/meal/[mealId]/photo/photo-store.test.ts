// @vitest-environment node
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { describe, expect, it } from "vitest";
import { HttpReadablePhotoStore } from "./photo-store";

const key = "spaces/s1/meals/m1/fictional";
describe("readable PhotoStore adapter", () => {
  it("reads original bytes through the store's URL boundary", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const store = new HttpReadablePhotoStore(new MemoryPhotoStore(), (input) => {
      expect(input).toBe(`https://photos.example.invalid/${key}/original.jpg`);
      return Promise.resolve(new Response(bytes));
    });
    const response = new Response(await store.read(key, "original"));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
  it("does not expose URLs or vendor errors on failure", async () => {
    const store = new HttpReadablePhotoStore(new MemoryPhotoStore(), () =>
      Promise.reject(new Error("private signed URL")),
    );
    await expect(store.read(key, "original")).rejects.toThrow(/^photo-unavailable$/);
  });
});
