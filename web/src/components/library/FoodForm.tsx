"use client";
import { carbsFor } from "@frejsi/shared/food/portions";
import {
  CreateFoodRequest,
  UpdateFoodRequest,
  type FoodCategory,
  type FoodView,
  type Portion,
} from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { FoodPhoto, PhotoPicker } from "@/components/food";
import { Badge, Button, Checkbox, NumberInput, TextInput } from "@/components/ui";

import { libraryApi, OWN_ORIGINS } from "./api-client";
import { CategoryChips } from "./CategoryChips";
import { useFoodText } from "./format";
import styles from "./library.module.css";

interface Row {
  key: number;
  label: string;
  grams: string;
  carbs: string;
}

/** "40,5" and "40.5" both read as 40.5; one decimal, as the contract stores it. */
function parseNumber(value: string): number | undefined {
  const trimmed = value.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : undefined;
}
export function parseDecimal(value: string): number | undefined {
  const parsed = parseNumber(value);
  return parsed === undefined ? undefined : Math.round(parsed * 10) / 10;
}
/** Whole grams of carbohydrate, rounded once from what was typed (14,49 → 14). */
function parseWhole(value: string): number | undefined {
  const parsed = parseNumber(value);
  return parsed === undefined ? undefined : Math.round(parsed);
}

/** A portion's carbs: computed from the per-100 g value when its grams are given, else typed. */
function portionCarbs(per100g: number | undefined, row: Row): number | undefined {
  const grams = parseDecimal(row.grams);
  if (per100g !== undefined && grams !== undefined && grams > 0)
    return carbsFor({ carbsPer100g: per100g }, grams);
  return parseWhole(row.carbs);
}

let rowKeys = 0;
const toRow = (portion?: Portion): Row => ({
  key: ++rowKeys,
  label: portion?.label ?? "",
  grams: portion?.grams === undefined ? "" : String(portion.grams),
  carbs: portion === undefined ? "" : String(portion.carbs),
});

export interface FoodFormProps {
  spaceId: string;
  /** The food being edited; absent for "Ny fødevare". */
  food?: FoodView;
  /**
   * The id of the page's own title when the form is a page of its own (the phone): the form is
   * named by it and draws no second "Ny fødevare". Without it (the desktop panel) the form carries
   * its own heading.
   */
  titleId?: string;
  /** `sent` is set only when the box was ticked: how the send ended (the food is saved either way). */
  onSaved: (food: FoodView, previous?: FoodView, sent?: "sent" | "failed") => void;
}

/**
 * The food form (Bibliotek-Desktop's edit panel; the phone pages reuse it): photo, name, source
 * line, carbs per 100 g, first-class portions, "Favorit", "Gem og godkend" / "Gem".
 *
 * Hard rules: the body never carries `verified` (the tick is `verify: true` on create or the
 * explicit `POST foods/verify`); a picked photo is only previewed until the form is saved, then
 * sent to `PUT foods/[id]/photo`. A failed save keeps everything that was typed.
 */
export function FoodForm({ spaceId, food, titleId, onSaved }: FoodFormProps) {
  const t = useTranslations("library.form");
  const text = useFoodText();
  const headingId = useId();
  const [name, setName] = useState(food?.name ?? "");
  const [per100g, setPer100g] = useState(
    food?.carbsPer100g == null ? "" : text.number(food.carbsPer100g),
  );
  const [rows, setRows] = useState<Row[]>(() =>
    food && food.portions.length > 0 ? food.portions.map(toRow) : [toRow()],
  );
  const [favourite, setFavourite] = useState(food?.favourite ?? false);
  const [category, setCategory] = useState<FoodCategory | "">(food?.category ?? "");
  const [photo, setPhoto] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<
    "needsName" | "needsCarbs" | "invalidNumber" | "saveFailed" | null
  >(null);
  // After a create succeeded, a retry (say, the photo upload failed) updates that row instead of
  // creating a second one.
  const [saved, setSaved] = useState<FoodView | undefined>(food);
  const submitter = useRef<"save" | "verify">("save");
  // "Send rettelsen" (spec §4): never remembered, never automatic. Unticked on every open and
  // again after every save; the plugin ids come from the route, no plugin is named here.
  const [available, setAvailable] = useState<string[]>([]);
  const [send, setSend] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<"sent" | "failed" | null>(null);
  const origin = (saved ?? food)?.origin;
  useEffect(() => {
    if (!origin || OWN_ORIGINS.has(origin)) return;
    let live = true;
    libraryApi
      .contributions(spaceId)
      .then((ids) => {
        if (live) setAvailable(ids);
      })
      .catch(() => {
        if (live) setAvailable([]);
      });
    return () => {
      live = false;
    };
  }, [spaceId, origin]);
  const canSend = origin !== undefined && !OWN_ORIGINS.has(origin) && available.includes(origin);

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(
      new Blob([photo as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }),
    );
    setPreview(url);
    return () => {
      // The preview ends with the picked bytes: after an upload the saved thumbnail shows.
      setPreview(undefined);
      URL.revokeObjectURL(url);
    };
  }, [photo]);

  const per100 = parseDecimal(per100g);

  /**
   * The typed values, or the reason they cannot be saved. A field that is filled in but cannot be
   * read (or is out of range) is reported, never sent as empty: that would delete a value.
   */
  function fields():
    { portions: Portion[]; carbsPer100g: number | undefined } | "needsCarbs" | "invalidNumber" {
    const filled = (value: string) => value.trim() !== "";
    const inRange = (value: number | undefined, min: number, max: number) =>
      value !== undefined && value >= min && value <= max;
    if (filled(per100g) && !inRange(per100, 0, 100)) return "invalidNumber";
    const portions: Portion[] = [];
    for (const row of rows) {
      const label = row.label.trim();
      if (!label && !filled(row.grams) && !filled(row.carbs)) continue;
      const grams = parseDecimal(row.grams);
      if (filled(row.grams) && !inRange(grams, 1, 5000)) return "invalidNumber";
      const computed = per100 !== undefined && grams !== undefined;
      if (!computed && filled(row.carbs) && !inRange(parseWhole(row.carbs), 0, 1000))
        return "invalidNumber";
      const carbs = portionCarbs(per100, row);
      if (!label || carbs === undefined) return "needsCarbs";
      portions.push({ label, carbs, ...(grams === undefined ? {} : { grams }) });
    }
    if (per100 === undefined && portions.length === 0) return "needsCarbs";
    return { portions, carbsPer100g: per100 };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const verify = submitter.current === "verify";
    if (!name.trim()) {
      setProblem("needsName");
      return;
    }
    const values = fields();
    if (typeof values === "string") {
      setProblem(values);
      return;
    }
    setSaving(true);
    setProblem(null);
    setSendOutcome(null);
    try {
      let result: FoodView;
      if (!saved) {
        const body = CreateFoodRequest.parse({
          name,
          portions: values.portions,
          favourite,
          ...(values.carbsPer100g === undefined ? {} : { carbsPer100g: values.carbsPer100g }),
          ...(category ? { category } : {}),
        });
        result = await libraryApi.create(spaceId, body, { verify });
      } else {
        // The category goes only when it changed: omitted means unchanged, null clears it.
        const body = UpdateFoodRequest.parse({
          name,
          carbsPer100g: values.carbsPer100g ?? null,
          portions: values.portions,
          favourite,
          ...(category === (saved.category ?? "") ? {} : { category: category || null }),
        });
        result = await libraryApi.update(spaceId, saved.id, body);
        if (verify && !result.verified) {
          await libraryApi.verify(spaceId, [result.id]);
          result = { ...result, verified: true };
        }
      }
      setSaved(result);
      if (photo) {
        const withPhoto = await libraryApi.putPhoto(spaceId, result.id, photo);
        if (withPhoto) result = { ...withPhoto, verified: withPhoto.verified || result.verified };
        setPhoto(null);
        setSaved(result);
      }
      // The food is saved. Only now, and only for a ticked box, the correction goes out; a failed
      // send never undoes the save.
      let outcome: "sent" | "failed" | undefined;
      if (send && canSend) {
        try {
          await libraryApi.sendCorrection(spaceId, result.id);
          outcome = "sent";
        } catch {
          outcome = "failed";
        }
        setSendOutcome(outcome);
      }
      setSend(false);
      onSaved(result, food, outcome);
    } catch {
      setProblem("saveFailed");
    } finally {
      setSaving(false);
    }
  }

  const current = saved ?? food;
  const sourceLine =
    current && !text.isOwn(current.origin)
      ? current.sourceName
        ? `${text.sourceName(current.origin)} · ${current.sourceName}`
        : current.barcode
          ? t("source", { source: text.sourceName(current.origin), barcode: current.barcode })
          : text.sourceName(current.origin)
      : undefined;

  // A new food on a page with its own title shows no head until a photo is picked.
  const ownHeading = current !== undefined || titleId === undefined;
  const showHead = ownHeading || preview !== undefined;

  return (
    <form
      className={styles.form}
      aria-labelledby={titleId ?? headingId}
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {showHead && (
        <div className={styles.formHead}>
          <div className={styles.formPhoto}>
            <FoodPhoto
              src={preview ?? current?.photo?.thumbUrl}
              alt={preview ? t("photoPreview") : ""}
              size={72}
            />
          </div>
          <div className={styles.formTitle}>
            {ownHeading && <h2 id={headingId}>{current ? current.name : t("newTitle")}</h2>}
            {sourceLine && <p className={styles.muted}>{sourceLine}</p>}
            {current && <Badge verified={current.verified} />}
          </div>
        </div>
      )}
      <PhotoPicker onPhoto={setPhoto} />
      <TextInput
        label={t("name")}
        value={name}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <TextInput
        label={t("carbsPer100g")}
        inputMode="decimal"
        value={per100g}
        onChange={(event) => {
          setPer100g(event.target.value);
        }}
      />
      <fieldset className={styles.portionRows}>
        <legend>{t("portions")}</legend>
        {rows.map((row, index) => {
          const computed =
            per100 !== undefined && (parseDecimal(row.grams) ?? 0) > 0
              ? portionCarbs(per100, row)
              : undefined;
          const update = (patch: Partial<Row>) => {
            setRows((list) =>
              list.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
            );
          };
          return (
            <div className={styles.portionRow} key={row.key} data-testid="portion-row">
              <TextInput
                label={t("portionName")}
                value={row.label}
                maxLength={40}
                onChange={(event) => {
                  update({ label: event.target.value });
                }}
              />
              <NumberInput
                label={t("portionGrams")}
                value={row.grams}
                min={1}
                max={5000}
                step={1}
                onChange={(event) => {
                  update({ grams: event.target.value });
                }}
              />
              {computed !== undefined ? (
                <output className={styles.computed}>{t("computed", { amount: computed })}</output>
              ) : (
                <NumberInput
                  label={t("portionCarbs")}
                  value={row.carbs}
                  min={0}
                  max={1000}
                  step={1}
                  onChange={(event) => {
                    update({ carbs: event.target.value });
                  }}
                />
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  className={styles.textButton}
                  aria-label={`${t("removePortion")} ${index + 1}`}
                  onClick={() => {
                    setRows((list) => list.filter((item) => item.key !== row.key));
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className={styles.addPortion}
          onClick={() => {
            setRows((list) => [...list, toRow()]);
          }}
        >
          {t("addPortion")}
        </button>
      </fieldset>
      <CategoryChips value={category} onChange={setCategory} />
      <Checkbox
        label={t("favourite")}
        checked={favourite}
        onChange={(event) => {
          setFavourite(event.target.checked);
        }}
      />
      {canSend && origin && (
        <Checkbox
          label={t("contribute", { source: text.sourceName(origin) })}
          checked={send}
          onChange={(event) => {
            setSend(event.target.checked);
          }}
        />
      )}
      {sendOutcome && (
        <p
          aria-live="polite"
          data-testid="contribution-outcome"
          className={sendOutcome === "failed" ? styles.problem : styles.muted}
        >
          {t(sendOutcome === "sent" ? "contributeSent" : "contributeFailed", {
            source: text.sourceName(origin ?? ""),
          })}
        </p>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {t(problem)}
        </p>
      )}
      <div className={styles.formActions}>
        {!current?.verified && (
          <Button
            type="submit"
            disabled={saving}
            onClick={() => {
              submitter.current = "verify";
            }}
          >
            {t("saveAndVerify")}
          </Button>
        )}
        <Button
          type="submit"
          variant={current?.verified ? "primary" : "secondary"}
          disabled={saving}
          onClick={() => {
            submitter.current = "save";
          }}
        >
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
