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
  kind: "native" | "zxing";
  /** The first valid, normalised barcode in the current video frame, or null. */
  detect(video: HTMLVideoElement): Promise<string | null>;
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

/** A typed or USB-scanned value is a barcode when it has 8, 12 or 13 digits and a valid checksum. */
export function asTypedBarcode(value: string): string | null {
  return normaliseBarcode(value.trim());
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

function canvasFrame(video: HTMLVideoElement): ImageData | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
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
        maxNumberOfSymbols: 1,
      });
      return firstValid(found.map((item) => item.text));
    },
  };
  return reader;
}

export async function createBarcodeReader(options: ReaderOptions = {}): Promise<BarcodeReader> {
  return (await nativeReader()) ?? zxingReader(options.grabFrame ?? canvasFrame);
}
