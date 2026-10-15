"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { createBarcodeReader, type BarcodeReader } from "@/lib/barcode/detect";

import styles from "./meal.module.css";

/**
 * The full-screen rear-camera view (design gap 8): the video, a frame to aim with, a 44 px close
 * and "Skriv stregkoden". Frames are read every `intervalMs` until a barcode with a valid checksum
 * is found; the camera is stopped before `onDetected`. A denied or missing camera calls `onDenied`
 * so the screen can show the typed-barcode field instead.
 */
export function BarcodeScanner({
  onDetected,
  onClose,
  onTypeBarcode,
  onDenied,
  createReader = createBarcodeReader,
  intervalMs = 250,
}: {
  onDetected: (barcode: string) => void;
  onClose: () => void;
  onTypeBarcode: () => void;
  onDenied: () => void;
  createReader?: () => Promise<BarcodeReader>;
  intervalMs?: number;
}) {
  const t = useTranslations("log.scanner");
  const kit = useTranslations("foodKit");
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onDetected, onDenied });
  callbacks.current = { onDetected, onDenied };

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
    void (async () => {
      try {
        const media = (navigator as Partial<Navigator>).mediaDevices;
        if (!media) throw new Error("no camera");
        run.stream = await media.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!isStopped()) callbacks.current.onDenied();
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
      } catch {
        const wasStopped = isStopped();
        stop();
        if (!wasStopped) callbacks.current.onDenied();
        return;
      }
      const tick = async () => {
        if (isStopped() || !video.current) return;
        const code = await reader.detect(video.current).catch(() => null);
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
      <video ref={video} className={styles.scannerVideo} playsInline muted aria-hidden="true" />
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
