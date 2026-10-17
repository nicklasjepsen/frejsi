"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import {
  CAMERA_CONSTRAINTS,
  confirmedReads,
  createBarcodeReader,
  describeCameraError,
  errorText,
  type BarcodeReader,
  type ScanFailure,
} from "@/lib/barcode/detect";

import styles from "./meal.module.css";

/** A video element has a frame to draw once its readyState reaches HAVE_CURRENT_DATA. */
const HAVE_CURRENT_DATA = 2;
/** Detection errors in a row before the scanner gives up and says why. */
const MAX_DETECT_FAILURES = 3;

/**
 * The full-screen rear-camera view (design gap 8): the video, a frame to aim with, a 44 px close
 * and "Skriv stregkoden". Frames are read every `intervalMs` until two frames in a row read the
 * same barcode with a valid checksum (`confirmedReads`); the camera is stopped before `onDetected`. A denied, missing or busy camera, or a
 * reader that cannot start, calls `onFailed` with the reason and the browser's own error text, so
 * the screen can show the typed-barcode field and say what went wrong.
 */
export function BarcodeScanner({
  onDetected,
  onClose,
  onTypeBarcode,
  onFailed,
  createReader = createBarcodeReader,
  intervalMs = 250,
}: {
  onDetected: (barcode: string) => void;
  onClose: () => void;
  onTypeBarcode: () => void;
  onFailed: (failure: ScanFailure) => void;
  createReader?: () => Promise<BarcodeReader>;
  intervalMs?: number;
}) {
  const t = useTranslations("log.scanner");
  const kit = useTranslations("foodKit");
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onDetected, onFailed });
  callbacks.current = { onDetected, onFailed };

  useEffect(() => {
    // Mutated from callbacks, so kept in an object rather than narrowed locals.
    const run: {
      stopped: boolean;
      stream: MediaStream | null;
      timer: ReturnType<typeof setTimeout> | undefined;
    } = { stopped: false, stream: null, timer: undefined };
    // A function, not a property read: TypeScript would keep a narrowed value across the awaits.
    const isStopped = () => run.stopped;
    const stop = () => {
      run.stopped = true;
      if (run.timer !== undefined) clearTimeout(run.timer);
      run.stream?.getTracks().forEach((track) => {
        track.stop();
      });
    };
    const fail = (failure: ScanFailure) => {
      const wasStopped = isStopped();
      stop();
      if (!wasStopped) callbacks.current.onFailed(failure);
    };
    void (async () => {
      const media = (navigator as Partial<Navigator>).mediaDevices;
      if (!media) {
        const secure = (globalThis as { isSecureContext?: boolean }).isSecureContext;
        fail({
          reason: "noCamera",
          detail: secure === false ? "insecure context" : "navigator.mediaDevices is unavailable",
        });
        return;
      }
      try {
        run.stream = await media.getUserMedia(CAMERA_CONSTRAINTS);
      } catch (error) {
        fail(describeCameraError(error));
        return;
      }
      if (isStopped()) {
        stop();
        return;
      }
      const element = video.current;
      if (element) {
        element.srcObject = run.stream;
        try {
          await element.play();
        } catch {
          // Autoplay refused: the frame stays black, detection still runs on what arrives.
        }
      }
      let reader: BarcodeReader;
      try {
        reader = await createReader();
      } catch (error) {
        fail({ reason: "reader", detail: errorText(error) });
        return;
      }
      const detect = confirmedReads((frame) => reader.detect(frame));
      let failures = 0;
      const tick = async () => {
        if (isStopped() || !video.current) return;
        if (video.current.readyState < HAVE_CURRENT_DATA) {
          // No frame yet (iOS takes a moment after play()): nothing to read, nothing wrong.
          run.timer = setTimeout(() => void tick(), intervalMs);
          return;
        }
        let code: string | null = null;
        try {
          code = await detect(video.current);
          failures = 0;
        } catch (error) {
          failures += 1;
          if (failures >= MAX_DETECT_FAILURES) {
            fail({ reason: "reader", detail: errorText(error) });
            return;
          }
        }
        if (isStopped()) return;
        if (code) {
          stop();
          callbacks.current.onDetected(code);
          return;
        }
        run.timer = setTimeout(() => void tick(), intervalMs);
      };
      void tick();
    })();
    return stop;
  }, [createReader, intervalMs]);

  return (
    <div className={styles.scanner} role="dialog" aria-modal="true" aria-label={t("title")}>
      <video
        ref={video}
        className={styles.scannerVideo}
        autoPlay
        playsInline
        muted
        aria-hidden="true"
      />
      <div className={styles.scannerFrame} aria-hidden="true" />
      <button
        type="button"
        className={styles.scannerClose}
        aria-label={kit("close")}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className={styles.scannerFooter}>
        <p>{t("aim")}</p>
        <button type="button" className={styles.scannerType} onClick={onTypeBarcode}>
          {t("typeBarcode")}
        </button>
      </div>
    </div>
  );
}
