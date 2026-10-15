"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";
import { downscale } from "@/lib/photos/downscale";
import { Button } from "../ui/Button";
import styles from "./food.module.css";

/** Prepares bytes for local preview. The caller uploads only when the form is saved. */
export function PhotoPicker({ onPhoto }: { onPhoto: (bytes: Uint8Array) => void }) {
  const t = useTranslations("foodKit");
  const capture = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!picked || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const jpeg = await downscale(picked);
      onPhoto(new Uint8Array(await jpeg.arrayBuffer()));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.picker} aria-busy={busy}>
      <Button variant="secondary" onClick={() => capture.current?.click()} disabled={busy}>
        {t("takePhoto")}
      </Button>
      <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
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
