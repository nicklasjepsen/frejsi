// Barcode detection for the phone camera (plan §2, decision 31). `BarcodeDetector` where the
// browser has one that reads retail codes; otherwise the self-hosted zxing-wasm build, loaded only
// when the scanner opens. iOS Safari has no `BarcodeDetector`, and the family's phones are iPhones.
// Every value goes through `normaliseBarcode` before any lookup: a misread never reaches the API.
import { normaliseBarcode } from "@frejsi/shared/food/barcode";

/** Where `web/public/zxing/` is served; the CDN default of zxing-wasm is never used. */
export const ZXING_WASM_PATH = "/zxing/zxing_reader.wasm";

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a"] as const;
const ZXING_FORMATS = ["EAN13", "EAN8", "UPCA"] as const;

export interface BarcodeReader {
  /** The reader in use; flips to "zxing" when a native detector exists but cannot detect. */
  kind: "native" | "zxing";
  /** The first valid, normalised barcode in the current video frame, or null. */
  detect(video: HTMLVideoElement): Promise<string | null>;
}

/** Why the scanner could not run; shown to the person with the typed-barcode field. */
export type ScanFailureReason = "denied" | "noCamera" | "busy" | "reader";
export interface ScanFailure {
  reason: ScanFailureReason;
  /** The browser's own error name and message, so a report from a phone says what failed. */
  detail: string;
}

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

export interface ReaderOptions {
  /** Draws the current video frame; replaced in tests. Null while the video has no frame yet. */
  grabFrame?: (video: HTMLVideoElement) => ImageData | null;
}

/**
 * The camera the scanner asks for: the rear camera at full HD where the phone offers it. Without
 * a size, iOS Safari hands out a small frame, and a retail barcode a few pixels per bar is where
 * the decoders start guessing digits that happen to pass the checksum.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

/** Consecutive frames that must read the same code before the scanner believes it. */
export const CONFIRM_READS = 2;

/**
 * A detect function that answers only when `needed` consecutive frames read the same code. One
 * frame's misread survives the EAN checksum about one time in ten; two independent frames
 * agreeing on the same wrong digits is rare. A different code, or an empty frame, starts over.
 */
export function confirmedReads(
  detect: BarcodeReader["detect"],
  needed: number = CONFIRM_READS,
): BarcodeReader["detect"] {
  let candidate: string | null = null;
  let seen = 0;
  return async (video) => {
    const code = await detect(video);
    if (!code) {
      candidate = null;
      seen = 0;
      return null;
    }
    if (code === candidate) seen += 1;
    else {
      candidate = code;
      seen = 1;
    }
    if (seen < needed) return null;
    candidate = null;
    seen = 0;
    return code;
  };
}

/** A typed or USB-scanned value is a barcode when it has 8, 12 or 13 digits and a valid checksum. */
export function asTypedBarcode(value: string): string | null {
  return normaliseBarcode(value.trim());
}

/**
 * `name` and `message` of whatever was thrown. Duck-typed: a `DOMException` is not an `Error`
 * in every runtime (jsdom, older WebKit), and the name is what tells the cases apart.
 */
function errorParts(error: unknown): { name: string; message: string } {
  if (typeof error === "object" && error !== null) {
    const { name, message } = error as { name?: unknown; message?: unknown };
    return {
      name: typeof name === "string" ? name : "",
      message: typeof message === "string" ? message : Object.prototype.toString.call(error),
    };
  }
  return { name: "", message: String(error) };
}

/** "NotAllowedError: Permission denied": the browser's own words, for the person's report. */
export function errorText(error: unknown): string {
  const { name, message } = errorParts(error);
  return name && message ? `${name}: ${message}` : name || message;
}

/** Sorts a `getUserMedia` rejection into what the person can do about it. */
export function describeCameraError(error: unknown): ScanFailure {
  const { name } = errorParts(error);
  const detail = errorText(error);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { reason: "denied", detail };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { reason: "busy", detail };
    default:
      // NotFoundError, OverconstrainedError, TypeError and anything else: no usable camera.
      return { reason: "noCamera", detail };
  }
}

function firstValid(values: Iterable<string>): string | null {
  for (const value of values) {
    const code = normaliseBarcode(value);
    if (code) return code;
  }
  return null;
}

async function nativeReader(): Promise<BarcodeReader | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  let supported: string[];
  try {
    supported = await Detector.getSupportedFormats();
  } catch {
    return null;
  }
  const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
  if (!formats.includes("ean_13")) return null;
  const detector = new Detector({ formats });
  return {
    kind: "native",
    async detect(video) {
      const found = await detector.detect(video);
      return firstValid(found.map((item) => item.rawValue));
    },
  };
}

/**
 * One canvas for the whole scan, sized to the video's intrinsic frame. A fresh canvas per frame
 * (four a second at 1080p) runs into iOS Safari's canvas memory limit, after which `getContext`
 * returns null or the page is reloaded: the scanner would then look like it does nothing.
 */
export function frameGrabber(): (video: HTMLVideoElement) => ImageData | null {
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  return (video) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      context = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!context) return null;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  };
}

async function zxingReader(grabFrame: (video: HTMLVideoElement) => ImageData | null) {
  const { prepareZXingModule, readBarcodes } = await import("zxing-wasm/reader");
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? ZXING_WASM_PATH : prefix + path,
    },
  });
  const reader: BarcodeReader = {
    kind: "zxing",
    async detect(video) {
      const frame = grabFrame(video);
      if (!frame) return null;
      const found = await readBarcodes(frame, {
        formats: [...ZXING_FORMATS],
        tryHarder: true,
        // Retail codes are never printed inverted, and a downscaled frame loses the thin bars.
        tryInvert: false,
        tryDownscale: false,
        // Scan lines that must agree inside one frame (zxing's default is 2).
        minLineCount: 4,
        maxNumberOfSymbols: 1,
      });
      return firstValid(found.filter((item) => item.isValid).map((item) => item.text));
    },
  };
  return reader;
}

/**
 * The native detector when the browser has one for EAN-13, else zxing. A native detector that
 * exists but throws on `detect` (Chrome without its detection service, a stubbed API) hands over to
 * zxing from that frame on instead of failing silently forever.
 */
export async function createBarcodeReader(options: ReaderOptions = {}): Promise<BarcodeReader> {
  const grabFrame = options.grabFrame ?? frameGrabber();
  const native = await nativeReader();
  if (!native) return zxingReader(grabFrame);
  let fallback: Promise<BarcodeReader> | null = null;
  const reader: BarcodeReader = {
    kind: "native",
    async detect(video) {
      if (!fallback) {
        try {
          return await native.detect(video);
        } catch {
          fallback = zxingReader(grabFrame);
          reader.kind = "zxing";
        }
      }
      return (await fallback).detect(video);
    },
  };
  return reader;
}
