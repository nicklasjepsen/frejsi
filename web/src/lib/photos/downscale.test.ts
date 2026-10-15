import { afterEach, describe, expect, it, vi } from "vitest";
import { downscale } from "./downscale";

afterEach(() => vi.restoreAllMocks());

describe("downscale", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/heic"])(
    "re-encodes %s on a canvas at most 1600 px",
    async (type) => {
      const draw = vi.fn();
      const revoke = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        value: () => "blob:fictional",
        configurable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        value: () => Promise.resolve(),
        configurable: true,
      });
      vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (
        this: HTMLImageElement,
      ) {
        Object.defineProperty(this, "naturalWidth", { value: 1500 });
        Object.defineProperty(this, "naturalHeight", { value: 2000 });
        return Promise.resolve();
      });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: draw,
        fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
        this: HTMLCanvasElement,
        callback,
        mime,
      ) {
        expect([this.width, this.height]).toEqual([1200, 1600]);
        expect(mime).toBe("image/jpeg");
        callback(new Blob(["fictional jpeg"], { type: mime ?? "" }));
      });
      const result = await downscale(new File(["fictional input"], "fiction.heic", { type }));
      expect(result.type).toBe("image/jpeg");
      expect(draw).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 1200, 1600);
      expect(revoke).toHaveBeenCalledWith("blob:fictional");
    },
  );
  it("rejects unsupported files before creating an image", async () => {
    await expect(
      downscale(new File(["%PDF"], "fiction.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("photo-type");
  });
  it("releases the object URL when a browser cannot decode an image", async () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: () => "blob:fictional",
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: revoke, configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      value: () => Promise.reject(new Error("decode failed")),
      configurable: true,
    });
    await expect(
      downscale(new File(["invalid"], "fiction.heic", { type: "image/heic" })),
    ).rejects.toThrow("photo-type");
    expect(revoke).toHaveBeenCalledWith("blob:fictional");
  });
});
