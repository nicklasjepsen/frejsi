"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";

import styles from "@/components/food/food.module.css";
import { Button } from "@/components/ui";
import { downscale } from "@/lib/photos/downscale";

/** The confirm photo picker in edit mode: its processing state also gates the meal's Save. */
export function EditPhotoPicker({
  onPhoto,
  onBusyChange,
}: {
  onPhoto: (bytes: Uint8Array) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations("foodKit");
  const capture = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!picked || locked.current) return;
    locked.current = true;
    setBusy(true);
    onBusyChange(true);
    setFailed(false);
    try {
      const jpeg = await downscale(picked);
      onPhoto(new Uint8Array(await jpeg.arrayBuffer()));
    } catch {
      setFailed(true);
    } finally {
      locked.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <div className={styles.picker} aria-busy={busy}>
      <Button
        variant="secondary"
        onClick={() => {
          capture.current?.click();
        }}
        disabled={busy}
      >
        {t("takePhoto")}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          file.current?.click();
        }}
        disabled={busy}
      >
        {t("attachPhoto")}
      </Button>
      <input
        hidden
        ref={capture}
        aria-label={t("takePhoto")}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        onChange={(event) => {
          void choose(event);
        }}
      />
      <input
        hidden
        ref={file}
        aria-label={t("attachPhoto")}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        onChange={(event) => {
          void choose(event);
        }}
      />
      {failed && <p role="alert">{t("photoError")}</p>}
    </div>
  );
}
