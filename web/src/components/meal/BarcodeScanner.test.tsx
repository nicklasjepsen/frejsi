import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { CAMERA_CONSTRAINTS, type BarcodeReader } from "@/lib/barcode/detect";
import { BarcodeScanner } from "./BarcodeScanner";

// GS1 restricted-circulation numbers: no real product.
const EAN13 = "2000000000015";
const OTHER = "2000000000022";

const getUserMedia = vi.fn();
const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;

beforeEach(() => {
  vi.useFakeTimers();
  getUserMedia.mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  // jsdom has no media pipeline: the video reports a frame and plays silently.
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
  getUserMedia.mockReset();
});

function mount(reads: (string | null)[]) {
  const onDetected = vi.fn();
  const onFailed = vi.fn();
  const detect = vi.fn(() => Promise.resolve(reads.shift() ?? null));
  const reader: BarcodeReader = { kind: "zxing", detect };
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <BarcodeScanner
        onDetected={onDetected}
        onClose={vi.fn()}
        onTypeBarcode={vi.fn()}
        onFailed={onFailed}
        createReader={() => Promise.resolve(reader)}
        intervalMs={100}
      />
    </I18nProvider>,
  );
  return { onDetected, onFailed, detect };
}

async function frames(count: number) {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
  }
}

describe("BarcodeScanner", () => {
  it("asks for the rear camera at full HD", async () => {
    mount([]);
    await frames(1);
    expect(getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
  });

  it("reports a barcode only after two frames in a row agree, so one misread never lands", async () => {
    // Frame by frame: a misread, the real code, the real code again.
    const { onDetected, onFailed, detect } = mount([EAN13, OTHER, OTHER]);
    // The first frame is read as soon as the camera is up, the next ones every intervalMs.
    await frames(1);
    expect(detect).toHaveBeenCalled();
    expect(onDetected).not.toHaveBeenCalled();
    await frames(3);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(OTHER);
    expect(onFailed).not.toHaveBeenCalled();
    expect(detect).toHaveBeenCalledTimes(3); // the camera stops with the answer
  });
});
