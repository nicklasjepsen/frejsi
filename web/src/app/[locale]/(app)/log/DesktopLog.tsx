"use client";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type KeyboardEvent } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { SearchField } from "@/components/food/SearchField";
import { GlucoseValue } from "@/components/glucose/GlucoseValue";
import { useNow } from "@/components/glucose/useNow";
import { LookupResults } from "@/components/meal/LookupResults";
import { ManualFoodForm } from "@/components/meal/ManualFoodForm";
import { MealItems } from "@/components/meal/MealItems";
import { TotalBar } from "@/components/meal/TotalBar";
import { useSourceLine } from "@/components/meal/source-line";
import { Chip } from "@/components/ui/Chip";
import { ListRow } from "@/components/ui/ListRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { asTypedBarcode } from "@/lib/barcode/detect";
import { formatClock } from "@/lib/i18n/time";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import { useOnline, type LogController } from "./controller";
import type { LogScreenProps } from "./LogScreen";
import styles from "./log.module.css";
import { Bolus, PhotoField, SaveNotices, TimeField, useMealTime, useSlotLabel } from "./parts";

type Props = LogScreenProps & { controller: LogController };

export const DESKTOP_SEARCH_ID = "log-desktop-search";

/** The glucose value with its age, from the live feed only (§3b), 22 px inline. */
function HeaderGlucose({ spaceId }: { spaceId: string }) {
  const feed = useLiveFeed(spaceId);
  const now = useNow();
  if (!feed.loaded) return null;
  return (
    <div className={styles.headerGlucose} data-testid="log-glucose">
      <GlucoseValue
        reading={feed.latest}
        unit={feed.space?.glucoseUnit ?? "mmol"}
        now={now}
        size="inline"
      />
    </div>
  );
}

/** Log-Desktop at 1280 px: search and results on the left, the meal on the right. */
export function DesktopLog({ controller, spaceId, timeZone, userName, simpleMode }: Props) {
  const t = useTranslations("log");
  const errors = useTranslations("errors.api");
  const locale = useLocale();
  const online = useOnline();
  const clock = useNow();
  const at = useMealTime(controller);
  const slot = useSlotLabel(at, timeZone);
  const { line } = useSourceLine();
  const [mode, setMode] = useState<"favourites" | "recent">("favourites");
  const [highlighted, setHighlighted] = useState(0);
  /** The arrows were used on this answer: Enter then adds the row even before a full search. */
  const [moved, setMoved] = useState(false);
  const response = controller.response;
  const rowCount = response ? response.results.length + 1 : 0;

  // A new answer or a changed query starts the highlight over: Enter never adds a stale row.
  useEffect(() => {
    setHighlighted(0);
    setMoved(false);
  }, [response, controller.query]);

  // `/` focuses the field; ⌘↩ or Ctrl+Enter saves the meal from anywhere on the screen.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        document.getElementById(DESKTOP_SEARCH_ID)?.focus();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void controller.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [controller]);

  const onFieldKeys = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      // ⌘↩ saves; the field's own Enter (search or add) must not run as well.
      event.preventDefault();
      event.stopPropagation();
      void controller.save();
      return;
    }
    if (!response) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMoved(true);
      setHighlighted((index) => Math.min(index + 1, rowCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMoved(true);
      setHighlighted((index) => Math.max(index - 1, 0));
    }
  };

  /** Enter: a barcode looks it up; a query with every source's answer on screen adds the row. */
  const onEnter = (value: string) => {
    const barcode = asTypedBarcode(value) !== null;
    if (!barcode && response && (moved || controller.submitted === value.trim())) {
      const result = response.results[highlighted];
      if (result) void controller.pick(result);
      else controller.openManual(response.manual.name ?? value.trim());
      return;
    }
    void controller.submit(value);
  };

  const chipFoods: FoodView[] = mode === "favourites" ? controller.favourites : controller.recent;
  const subtitle = t("desktopSubtitle", {
    date: capitalise(
      new Intl.DateTimeFormat(locale, {
        timeZone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(clock),
    ),
    time: formatClock(clock, timeZone),
  });

  return (
    <div className={styles.desktop} data-testid="log-desktop">
      <div className={styles.desktopHeader}>
        <PageHeader title={t("title")} subtitle={subtitle} />
        <HeaderGlucose spaceId={spaceId} />
      </div>
      <div className={styles.columns}>
        <section className={styles.searchColumn}>
          {/* Arrow keys move the highlight; the field's own Enter handler adds or searches. */}
          <div onKeyDownCapture={onFieldKeys}>
            <SearchField
              id={DESKTOP_SEARCH_ID}
              label={t("search.desktopLabel")}
              placeholder={t("search.desktopLabel")}
              icon="barcode"
              shortcut="/"
              hint={t("search.desktopHint")}
              value={controller.query}
              onChange={controller.setQuery}
              onSubmit={onEnter}
            />
          </div>
          {controller.lookupFailed && <p role="alert">{errors("lookup-unavailable")}</p>}
          {controller.pickFailed && <p role="alert">{t("manual.failed")}</p>}
          {controller.manual ? (
            <ManualFoodForm
              initialName={controller.manual.name}
              barcode={controller.manual.barcode}
              busy={controller.manualBusy}
              failed={controller.manualFailed}
              onCreate={(request) => void controller.createManual(request)}
              onCancel={controller.closeManual}
            />
          ) : response ? (
            <LookupResults
              desktop
              response={response}
              query={controller.query}
              highlighted={highlighted}
              onPick={(result) => void controller.pick(result)}
              onManual={() => {
                controller.openManual(response.manual.name ?? controller.query.trim());
              }}
            />
          ) : (
            <>
              <div className={styles.chips} role="group">
                <Chip
                  pressed={mode === "favourites"}
                  onClick={() => {
                    setMode("favourites");
                  }}
                >
                  {t("favourites")}
                </Chip>
                <Chip
                  pressed={mode === "recent"}
                  onClick={() => {
                    setMode("recent");
                  }}
                >
                  {t("recent")}
                </Chip>
              </div>
              <ul className={styles.list} role="list" data-testid="chip-foods">
                {chipFoods.map((food) => (
                  <li key={food.id}>
                    <ListRow
                      title={food.name}
                      verified={food.verified}
                      secondary={line(food)}
                      photo={<FoodPhoto src={food.photo?.thumbUrl} />}
                      onClick={() => {
                        controller.addToMeal(food);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className={styles.mealColumn} aria-labelledby="log-meal-title">
          <div className={styles.mealHead}>
            <h2 id="log-meal-title">{slot}</h2>
            <p>{t("mealMeta", { time: formatClock(at, timeZone), name: userName })}</p>
          </div>
          <SaveNotices controller={controller} online={online} />
          <MealItems
            desktop
            items={controller.draft.items}
            onRemove={controller.removeItem}
            onPortion={controller.choosePortion}
            onGrams={controller.chooseGrams}
          />
          <TimeField controller={controller} at={at} timeZone={timeZone} />
          <PhotoField controller={controller} />
          <Bolus controller={controller} timeZone={timeZone} simpleMode={simpleMode} />
          <TotalBar
            total={controller.total}
            actionLabel={t("save")}
            shortcut={t("saveShortcut")}
            onAction={() => void controller.save()}
            disabled={!controller.complete || controller.saving}
          />
        </section>
      </div>
    </div>
  );
}

const capitalise = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);
