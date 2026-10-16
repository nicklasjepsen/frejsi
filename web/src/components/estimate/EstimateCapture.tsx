"use client";
import { useEffect, useRef, useState } from "react";
import type { PhotoEstimate } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { PhotoPicker } from "@/components/food/PhotoPicker";
import { PhotoTile } from "@/components/food/PhotoTile";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import styles from "./estimate.module.css";
import { EstimateError, photoUrl, requestEstimate } from "./api";

export function EstimateCapture({
  spaceId,
  simple,
  tile = false,
  onEstimate,
  onUnavailable,
}: {
  spaceId: string;
  simple: boolean;
  tile?: boolean;
  onEstimate: (estimate: PhotoEstimate, photoDataUrl: string) => void;
  onUnavailable: () => void;
}) {
  const t = useTranslations("ask");
  const food = useTranslations("foodKit");
  const eat = useTranslations("eat");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function capture(bytes: Uint8Array) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    const photoDataUrl = photoUrl(bytes);
    try {
      const estimate = await requestEstimate(spaceId, photoDataUrl);
      if (active.current) onEstimate(estimate, photoDataUrl);
    } catch (error) {
      if (!active.current) return;
      if (
        error instanceof EstimateError &&
        ["ai-disabled", "ai-cap-reached", "ai-unavailable", "ai-not-configured"].includes(
          error.code,
        )
      )
        onUnavailable();
      else setFailed(true);
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className={styles.capture} data-simple={simple} aria-busy={busy}>
      <PhotoPicker
        cameraOnly
        onPhoto={(bytes) => void capture(bytes)}
        renderCapture={(open, preparing) =>
          tile ? (
            <PhotoTile
              variant="capture"
              verified={false}
              title={eat("somethingElse")}
              subtitle={eat("photo")}
              disabled={busy || preparing}
              onClick={open}
            />
          ) : (
            <Button
              size={simple ? "simple" : "desktop"}
              disabled={busy || preparing}
              onClick={open}
            >
              {food("takePhoto")}
            </Button>
          )
        }
      />
      {busy && <p role="status">{t("busy")}</p>}
      {failed && <Notice role="alert">{t("unavailable")}</Notice>}
    </div>
  );
}
