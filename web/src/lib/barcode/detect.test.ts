import { afterEach, describe, expect, it, vi } from "vitest";

const zxing = vi.hoisted(() => ({
  prepare: vi.fn(),
  read: vi.fn(),
}));
vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: zxing.prepare,
  readBarcodes: zxing.read,
}));

import { ZXING_WASM_PATH, asTypedBarcode, createBarcodeReader } from "./detect";

// GS1 restricted-circulation numbers (20…–29…): no real product.
const EAN13 = "2000000000015";
const EAN8 = "20000004";
const UPCA = "200000000004"; // 12 digits; normalised with a leading zero
const frame = { width: 4, height: 4 } as unknown as ImageData;

afterEach(() => {
  vi.unstubAllGlobals();
  zxing.prepare.mockReset();
  zxing.read.mockReset();
});

describe("asTypedBarcode", () => {
  it("accepts 8, 12 and 13 digits with a valid checksum and normalises UPC-A", () => {
    expect(asTypedBarcode(EAN13)).toBe(EAN13);
    expect(asTypedBarcode(` ${EAN8} `)).toBe(EAN8);
    expect(asTypedBarcode(UPCA)).toBe(`0${UPCA}`);
  });
  it("treats anything else as text", () => {
    expect(asTypedBarcode("2000000000016")).toBeNull(); // bad checksum
    expect(asTypedBarcode("rugbrod")).toBeNull();
    expect(asTypedBarcode("123")).toBeNull();
  });
});

describe("createBarcodeReader", () => {
  it("uses BarcodeDetector where the browser has it, and validates the checksum", async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce([{ rawValue: "2000000000016" }])
      .mockResolvedValueOnce([{ rawValue: UPCA }]);
    const formats = vi.fn();
    class FakeDetector {
      static getSupportedFormats = () => Promise.resolve(["qr_code", "ean_13", "ean_8", "upc_a"]);
      constructor(options: { formats: string[] }) {
        formats(options.formats);
      }
      detect = detect;
    }
    vi.stubGlobal("BarcodeDetector", FakeDetector);
    const reader = await createBarcodeReader({ grabFrame: () => frame });
    expect(reader.kind).toBe("native");
    expect(formats).toHaveBeenCalledWith(["ean_13", "ean_8", "upc_a"]);
    const video = {} as HTMLVideoElement;
    expect(await reader.detect(video)).toBeNull();
    expect(await reader.detect(video)).toBe(`0${UPCA}`);
    expect(zxing.prepare).not.toHaveBeenCalled();
  });

  it("falls back to the self-hosted zxing-wasm build when there is no BarcodeDetector (iOS)", async () => {
    zxing.read.mockResolvedValueOnce([]).mockResolvedValueOnce([{ text: EAN13, isValid: true }]);
    const reader = await createBarcodeReader({ grabFrame: () => frame });
    expect(reader.kind).toBe("zxing");
    expect(zxing.prepare).toHaveBeenCalledTimes(1);
    const options = zxing.prepare.mock.calls[0]?.[0] as {
      overrides: { locateFile: (path: string, prefix: string) => string };
    };
    expect(options.overrides.locateFile("zxing_reader.wasm", "https://cdn.example/")).toBe(
      ZXING_WASM_PATH,
    );
    const video = {} as HTMLVideoElement;
    expect(await reader.detect(video)).toBeNull();
    expect(await reader.detect(video)).toBe(EAN13);
    expect(zxing.read).toHaveBeenCalledWith(
      frame,
      expect.objectContaining({ formats: ["EAN13", "EAN8", "UPCA"] }),
    );
  });

  it("falls back to zxing when BarcodeDetector cannot read retail codes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a browser global's shape
    class NoRetail {
      static getSupportedFormats = () => Promise.resolve(["qr_code"]);
    }
    vi.stubGlobal("BarcodeDetector", NoRetail);
    const reader = await createBarcodeReader({ grabFrame: () => frame });
    expect(reader.kind).toBe("zxing");
  });

  it("skips a frame it cannot grab yet", async () => {
    const reader = await createBarcodeReader({ grabFrame: () => null });
    expect(await reader.detect({} as HTMLVideoElement)).toBeNull();
    expect(zxing.read).not.toHaveBeenCalled();
  });
});
