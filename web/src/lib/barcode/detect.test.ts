import { afterEach, describe, expect, it, vi } from "vitest";

const zxing = vi.hoisted(() => ({
  prepare: vi.fn(),
  read: vi.fn(),
}));
vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: zxing.prepare,
  readBarcodes: zxing.read,
}));

import {
  CAMERA_CONSTRAINTS,
  ZXING_WASM_PATH,
  asTypedBarcode,
  confirmedReads,
  createBarcodeReader,
  describeCameraError,
  frameGrabber,
} from "./detect";

// GS1 restricted-circulation numbers (20…–29…): no real product.
const EAN13 = "2000000000015";
const EAN8 = "20000004";
const UPCA = "200000000004"; // 12 digits; normalised with a leading zero
const frame = { width: 4, height: 4 } as unknown as ImageData;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
      expect.objectContaining({
        formats: ["EAN13", "EAN8", "UPCA"],
        tryHarder: true,
        tryInvert: false,
        tryDownscale: false,
        minLineCount: 4,
      }),
    );
  });

  it("ignores a zxing result that is not valid even when its text passes the checksum", async () => {
    zxing.read.mockResolvedValueOnce([{ text: EAN13, isValid: false }]);
    const reader = await createBarcodeReader({ grabFrame: () => frame });
    expect(await reader.detect({} as HTMLVideoElement)).toBeNull();
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

  it("hands over to zxing when a BarcodeDetector exists but throws on detect", async () => {
    // Chrome without its detection service, or a stubbed API: getSupportedFormats answers,
    // detect never does. Before, every frame was swallowed and the scanner sat there forever.
    const detect = vi.fn().mockRejectedValue(new DOMException("unavailable", "NotSupportedError"));
    class Stub {
      static getSupportedFormats = () => Promise.resolve(["ean_13"]);
      detect = detect;
    }
    vi.stubGlobal("BarcodeDetector", Stub);
    zxing.read.mockResolvedValue([{ text: EAN13, isValid: true }]);
    const reader = await createBarcodeReader({ grabFrame: () => frame });
    expect(reader.kind).toBe("native");
    const video = {} as HTMLVideoElement;
    expect(await reader.detect(video)).toBe(EAN13);
    expect(reader.kind).toBe("zxing");
    expect(zxing.prepare).toHaveBeenCalledTimes(1);
    expect(await reader.detect(video)).toBe(EAN13);
    expect(detect).toHaveBeenCalledTimes(1);
  });
});

describe("frameGrabber", () => {
  it("draws every frame on one canvas sized to the video, never a canvas per frame", () => {
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => frame);
    const context = { drawImage, getImageData } as unknown as CanvasRenderingContext2D;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const created = vi.spyOn(document, "createElement");
    const grab = frameGrabber();
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    expect(grab(video)).toBeNull();
    expect(created).not.toHaveBeenCalled();
    Object.assign(video, { videoWidth: 640, videoHeight: 480 });
    expect(grab(video)).toBe(frame);
    expect(grab(video)).toBe(frame);
    expect(created).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenLastCalledWith(video, 0, 0, 640, 480);
    const canvas = created.mock.results[0]?.value as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([640, 480]);
    Object.assign(video, { videoWidth: 1280, videoHeight: 720 });
    grab(video);
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    expect(created).toHaveBeenCalledTimes(1);
  });
});

describe("describeCameraError", () => {
  it("sorts getUserMedia errors by what the person can do, keeping the browser's own text", () => {
    expect(describeCameraError(new DOMException("Permission denied", "NotAllowedError"))).toEqual({
      reason: "denied",
      detail: "NotAllowedError: Permission denied",
    });
    expect(describeCameraError(new DOMException("", "SecurityError")).reason).toBe("denied");
    expect(describeCameraError(new DOMException("in use", "NotReadableError"))).toEqual({
      reason: "busy",
      detail: "NotReadableError: in use",
    });
    expect(describeCameraError(new DOMException("none", "NotFoundError")).reason).toBe("noCamera");
    expect(describeCameraError(new TypeError("bad constraints")).reason).toBe("noCamera");
    expect(describeCameraError("odd")).toEqual({ reason: "noCamera", detail: "odd" });
  });
});

describe("confirmedReads", () => {
  const OTHER = "2000000000022";
  it("answers only when two frames in a row read the same code", async () => {
    const frames = [EAN13, OTHER, OTHER];
    const detect = confirmedReads(() => Promise.resolve(frames.shift() ?? null));
    const video = {} as HTMLVideoElement;
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBeNull(); // a different code starts over
    expect(await detect(video)).toBe(OTHER);
  });
  it("starts over after an empty frame and after an answer", async () => {
    const frames = [EAN13, null, EAN13, EAN13, EAN13];
    const detect = confirmedReads(() => Promise.resolve(frames.shift() ?? null));
    const video = {} as HTMLVideoElement;
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBe(EAN13);
    expect(await detect(video)).toBeNull(); // the run after an answer needs two again
  });
  it("takes the number of agreeing frames as a setting", async () => {
    const detect = confirmedReads(() => Promise.resolve(EAN13), 3);
    const video = {} as HTMLVideoElement;
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBeNull();
    expect(await detect(video)).toBe(EAN13);
  });
});

describe("CAMERA_CONSTRAINTS", () => {
  it("asks for the rear camera at full HD, as an ideal the phone may lower", () => {
    expect(CAMERA_CONSTRAINTS).toEqual({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  });
});
