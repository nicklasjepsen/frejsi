"use client";

import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { formatClock, withLocalTime } from "@/app/[locale]/(app)/log/time";
import { FoodPhoto } from "@/components/food/FoodPhoto";
import { EditPhotoPicker } from "@/components/meal/EditPhotoPicker";
import { deleteMeal, updateMeal } from "@/components/meal/api";
import { BolusTap } from "@/components/meal/BolusTap";
import { editableItems, EditMealItems, refreshNutrition } from "@/components/meal/EditMealItems";
import { TotalBar } from "@/components/meal/TotalBar";
import { Button } from "@/components/ui";

import styles from "./meal-detail.module.css";

function dataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Log-Portioner on the phone; a derived Log-Desktop meal column on desktop. */
export function EditMealSheet({
  spaceId,
  view,
  timeZone,
  size,
  onClose,
  onSaved,
  onDeleted,
}: {
  spaceId: string;
  view: MealCurveView;
  timeZone: string;
  size: "phone" | "desktop";
  onClose: () => void;
  onSaved: () => Promise<boolean>;
  onDeleted: () => void;
}) {
  const t = useTranslations("mealDetail.editSheet");
  const log = useTranslations("log");
  const [items, setItems] = useState(() => editableItems(view.editItems));
  const [itemsChanged, setItemsChanged] = useState(false);
  const [ts, setTs] = useState(view.meal.ts);
  const [bolusTs, setBolusTs] = useState(view.meal.bolusTs ?? null);
  const [note, setNote] = useState(view.meal.note ?? "");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [written, setWritten] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const libraryChanged = editableItems(view.editItems).some(
    (item) => refreshNutrition(item).input.carbs !== item.source.carbs,
  );
  const complete = items.length > 0 && items.every((item) => item.valid);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    if (typeof node?.showModal === "function") node.showModal();
    else node?.setAttribute("open", "");
    node?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (typeof node?.close === "function") node.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  async function save() {
    if (locked.current || photoBusy || !complete) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (!written) {
        await updateMeal(spaceId, view.meal.id, {
          ts,
          ...(itemsChanged ? { items: items.map((item) => item.input) } : {}),
          note,
          ...(bolusTs || view.meal.bolusTs ? { bolusTs } : {}),
          ...(photo ? { photoDataUrl: photo } : {}),
        });
        setWritten(true);
      }
      if (!(await onSaved())) {
        setRefreshFailed(true);
        return;
      }
      onClose();
    } catch {
      setFailed(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setDeleteFailed(false);
    try {
      await deleteMeal(spaceId, view.meal.id);
      onDeleted();
    } catch {
      setDeleteFailed(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.editSheet}
      data-size={size}
      aria-label={t("title")}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !photoBusy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy && !photoBusy) onClose();
        }
      }}
    >
      <div className={styles.sheetHeader}>
        <button
          type="button"
          className={styles.sheetBack}
          aria-label={t("back")}
          disabled={busy || photoBusy}
          onClick={onClose}
        >
          ←
        </button>
        <h2>{t("title")}</h2>
      </div>
      <fieldset className={styles.sheetBody} disabled={busy || written || photoBusy}>
        <EditMealItems
          items={items}
          desktop={size === "desktop"}
          onChange={(key, input, valid) => {
            setItemsChanged(true);
            setItems((current) =>
              current.map((item) =>
                refreshNutrition(item.key === key ? { ...item, input, valid } : item),
              ),
            );
          }}
          onRemove={(key) => {
            setItemsChanged(true);
            setItems((current) => current.filter((item) => item.key !== key).map(refreshNutrition));
          }}
        />
        {itemsChanged && libraryChanged && <p role="status">{t("currentNutrition")}</p>}
        <label className={styles.sheetField}>
          {log("time")}
          <input
            type="time"
            name="ts"
            value={formatClock(new Date(ts), timeZone)}
            onChange={(event) => {
              const at = withLocalTime(new Date(ts), event.target.value, timeZone);
              if (at) setTs(at.toISOString());
            }}
          />
        </label>
        <label className={styles.sheetField}>
          {t("note")}
          <textarea
            name="note"
            maxLength={500}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        {(photo ?? view.meal.photo) && (
          <FoodPhoto src={photo ?? view.meal.photo?.thumbUrl} alt={view.meal.title} size={72} />
        )}
        <EditPhotoPicker
          onBusyChange={setPhotoBusy}
          onPhoto={(bytes) => {
            setPhoto(dataUrl(bytes));
          }}
        />
        <BolusTap
          bolusTs={bolusTs}
          timeZone={timeZone}
          canUndo={bolusTs !== (view.meal.bolusTs ?? null)}
          {...(view.meal.bolusTs && bolusTs === view.meal.bolusTs
            ? {
                onRemove: () => {
                  setBolusTs(null);
                },
              }
            : {})}
          onTap={() => {
            setBolusTs(new Date().toISOString());
          }}
          onUndo={() => {
            setBolusTs(view.meal.bolusTs ?? null);
          }}
        />
        {failed && <p role="alert">{t("failed")}</p>}
        {confirmDelete ? (
          <div className={styles.deleteConfirm}>
            <p>{t("deleteQuestion")}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button variant="secondary" onClick={() => void remove()}>
              {t("confirmDelete")}
            </Button>
            {deleteFailed && <p role="alert">{t("deleteFailed")}</p>}
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            {t("delete")}
          </Button>
        )}
      </fieldset>
      {refreshFailed && (
        <p className={styles.sheetFeedback} role="alert">
          {t("refreshFailed")}
        </p>
      )}
      <TotalBar
        total={items.reduce((sum, item) => sum + (item.input.carbs ?? 0), 0)}
        actionLabel={t(written ? "reload" : "save")}
        disabled={busy || photoBusy || !complete || confirmDelete}
        onAction={() => void save()}
      />
    </dialog>
  );
}
