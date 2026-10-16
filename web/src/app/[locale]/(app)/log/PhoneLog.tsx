"use client";
import { foldForSearch } from "@frejsi/shared/food/search";
import type { FoodView } from "@frejsi/shared/schemas/food";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SayItSheet } from "@/components/say/SayItSheet";
import { FoodPhoto } from "@/components/food/FoodPhoto";
import { PhotoTile } from "@/components/food/PhotoTile";
import { SearchField } from "@/components/food/SearchField";
import { BarcodeScanner } from "@/components/meal/BarcodeScanner";
import { EntryTiles } from "@/components/meal/EntryTiles";
import { LookupResults } from "@/components/meal/LookupResults";
import { ManualFoodForm } from "@/components/meal/ManualFoodForm";
import { MealItems } from "@/components/meal/MealItems";
import { PortionSheet } from "@/components/meal/PortionSheet";
import { TotalBar } from "@/components/meal/TotalBar";
import { useSourceLine } from "@/components/meal/source-line";
import { BackButton } from "@/components/ui/BackButton";
import { Chip } from "@/components/ui/Chip";
import { ListRow } from "@/components/ui/ListRow";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { localeHref } from "@/lib/i18n/routing";

import { useOnline, type LogController } from "./controller";
import type { LogScreenProps } from "./LogScreen";
import styles from "./log.module.css";
import {
  Bolus,
  PhotoField,
  SaveNotices,
  TimeField,
  useMealTime,
  useSlotLabel,
  useWhenLabel,
} from "./parts";
import type { PhoneViewState } from "./phone-view";

type Props = LogScreenProps & { controller: LogController; phone: PhoneViewState };

/** Log-Telefon, Log-Portioner and the scanner, under 1280 px. */
export function PhoneLog(props: Props) {
  const { controller, phone } = props;
  const content = controller.manual ? (
    <ManualView {...props} />
  ) : phone.view === "confirm" ? (
    <ConfirmView {...props} />
  ) : phone.view === "library" ? (
    <LibraryView {...props} />
  ) : phone.view === "typeBarcode" ? (
    <TypeBarcodeView {...props} />
  ) : (
    <EntryView {...props} />
  );
  return (
    <>
      {controller.sayEnabled && (
        <div style={{ display: controller.sayOpen ? "contents" : "none" }}>
          <div className={styles.phone}>
            <SayItSheet
              active={controller.sayOpen}
              spaceId={props.spaceId}
              locale={props.locale}
              onClose={controller.closeSay}
              onAdd={controller.addParsed}
              onSearch={(query) => {
                controller.setQuery(query);
                controller.closeSay();
                phone.setView("entry");
              }}
            />
          </div>
        </div>
      )}
      {!controller.sayOpen && content}
    </>
  );
}

function EntryView({ controller, phone, locale }: Props) {
  const t = useTranslations("log");
  const errors = useTranslations("errors.api");
  const { firstPortion, format } = useSourceLine();
  const online = useOnline();
  const hasQuery = controller.query.trim() !== "";
  return (
    <div className={styles.phone} data-testid="log-phone">
      <PageHeader title={t("title")} onClose={controller.goNow} />
      {!online && (
        <Notice tone="sunken" role="status">
          {t("offline")}
        </Notice>
      )}
      <EntryTiles
        onSay={controller.sayEnabled ? controller.openSay : undefined}
        onScan={() => {
          phone.setCameraDenied(false);
          phone.setView("scan");
        }}
        onPick={() => {
          controller.loadLibrary();
          phone.setView("library");
        }}
      />
      <SearchField
        label={t("search.phoneLabel")}
        placeholder={t("search.phoneLabel")}
        value={controller.query}
        onChange={controller.setQuery}
        onSubmit={(value) => void controller.submit(value)}
      />
      {controller.lookupFailed && <p role="alert">{errors("lookup-unavailable")}</p>}
      {controller.pickFailed && <p role="alert">{t("manual.failed")}</p>}
      {hasQuery && controller.response ? (
        <LookupResults
          response={controller.response}
          query={controller.query}
          onPick={(result) => void controller.pick(result)}
          onManual={() => {
            controller.openManual(controller.response?.manual.name ?? controller.query.trim());
          }}
        />
      ) : (
        !hasQuery && (
          <>
            {controller.favourites.length > 0 && (
              <section className={styles.section} aria-labelledby="log-favourites">
                <div className={styles.sectionHead}>
                  <h2 id="log-favourites">{t("favourites")}</h2>
                  <Link href={localeHref(locale, "/library")}>{t("wholeLibrary")}</Link>
                </div>
                <div className={styles.tiles}>
                  {controller.favourites.map((food) => {
                    const subtitle = firstPortion(food);
                    return (
                      <PhotoTile
                        key={food.id}
                        title={food.name}
                        {...(subtitle ? { subtitle } : {})}
                        {...(food.photo ? { thumbUrl: food.photo.thumbUrl } : {})}
                        verified={food.verified}
                        size={92}
                        onClick={() => {
                          controller.addToMeal(food);
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            )}
            {controller.recent.length > 0 && (
              <section className={styles.section} aria-labelledby="log-recent">
                <h2 id="log-recent">{t("recent")}</h2>
                <div className={styles.chips}>
                  {controller.recent.map((food) => (
                    <Chip
                      key={food.id}
                      variant={food.verified ? "default" : "unverified"}
                      onClick={() => {
                        controller.addToMeal(food);
                      }}
                    >
                      {recentLabel(food, t, format)}
                    </Chip>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}
      {controller.draft.items.length > 0 && (
        <div className={styles.phoneTotal}>
          <TotalBar
            total={controller.total}
            actionLabel={t("showMeal")}
            onAction={() => {
              phone.setView("confirm");
            }}
          />
        </div>
      )}
      {phone.view === "scan" && (
        <BarcodeScanner
          onDetected={(code) => {
            phone.setView("entry");
            void controller.submitBarcode(code);
          }}
          onClose={() => {
            phone.setView("entry");
          }}
          onTypeBarcode={() => {
            phone.setView("typeBarcode");
          }}
          onDenied={() => {
            phone.setCameraDenied(true);
            phone.setView("typeBarcode");
          }}
        />
      )}
    </div>
  );
}

/** "Æble · 14 g": the name with its first portion's carbs. */
function recentLabel(
  food: FoodView,
  t: ReturnType<typeof useTranslations<"log">>,
  format: (value: number, digits: number) => string,
): string {
  const portion = food.portions[0];
  return portion ? t("chip", { name: food.name, amount: format(portion.carbs, 0) }) : food.name;
}

function TypeBarcodeView({ controller, phone }: Props) {
  const t = useTranslations("log");
  const [value, setValue] = useState("");
  return (
    <div className={styles.phone} data-testid="log-phone">
      <PageHeader
        title={t("scanner.typeBarcode")}
        onBack={() => {
          phone.setView("entry");
        }}
      />
      {phone.cameraDenied && (
        <Notice tone="sunken" role="status">
          {t("scanner.denied")}
        </Notice>
      )}
      <SearchField
        label={t("scanner.typedLabel")}
        icon="barcode"
        value={value}
        onChange={setValue}
        onSubmit={(raw) => {
          void controller.submitBarcode(raw).then((outcome) => {
            // "found" has already opened the confirm screen through the controller.
            if (outcome === "unknown") phone.setView("entry");
          });
        }}
      />
      {controller.barcodeInvalid && <p role="alert">{t("scanner.invalid")}</p>}
    </div>
  );
}

function LibraryView({ controller, phone }: Props) {
  const t = useTranslations("log");
  const { line } = useSourceLine();
  const [filter, setFilter] = useState("");
  const words = foldForSearch(filter).split(/\s+/).filter(Boolean);
  const foods = (controller.library ?? []).filter((food) => {
    const name = foldForSearch(food.name);
    return words.every((word) => name.includes(word));
  });
  return (
    <div className={styles.phone} data-testid="log-phone">
      <PageHeader
        title={t("library")}
        onBack={() => {
          phone.setView("entry");
        }}
      />
      <SearchField
        label={t("search.phoneLabel")}
        value={filter}
        onChange={setFilter}
        onSubmit={setFilter}
      />
      {controller.library?.length === 0 && <Notice tone="sunken">{t("libraryEmpty")}</Notice>}
      <ul className={styles.list} role="list">
        {foods.map((food) => (
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
    </div>
  );
}

function ManualView({ controller }: Props) {
  const t = useTranslations("log");
  const manual = controller.manual;
  if (!manual) return null;
  return (
    <div className={styles.phone} data-testid="log-phone">
      <PageHeader title={t("manual.title")} onBack={controller.closeManual} />
      <ManualFoodForm
        initialName={manual.name}
        barcode={manual.barcode}
        busy={controller.manualBusy}
        failed={controller.manualFailed}
        onCreate={(request) => void controller.createManual(request)}
      />
    </div>
  );
}

/** Log-Portioner: full screen over the tab bar, back keeps the meal, Annullér drops it. */
function ConfirmView({ controller, phone, timeZone, simpleMode }: Props) {
  const t = useTranslations("log");
  const kit = useTranslations("foodKit");
  const online = useOnline();
  const at = useMealTime(controller);
  const slot = useSlotLabel(at, timeZone);
  const when = useWhenLabel(at, timeZone);
  const active = controller.draft.items.find((item) => item.key === controller.activeKey);
  return (
    <div className={styles.confirm} data-testid="log-confirm">
      <header className={styles.confirmHeader}>
        <BackButton
          label={kit("back")}
          onClick={() => {
            phone.setView("entry");
          }}
        />
        <div className={styles.confirmTitle}>
          <h1>{slot}</h1>
          <p>{when}</p>
        </div>
        <button type="button" className={styles.cancel} onClick={controller.goNow}>
          {t("cancel")}
        </button>
      </header>
      <div className={styles.confirmBody}>
        <SaveNotices controller={controller} online={online} />
        <div className={styles.card}>
          <MealItems
            items={controller.draft.items}
            activeKey={controller.activeKey}
            onSelect={controller.setActiveKey}
            onRemove={controller.removeItem}
            onPortion={controller.choosePortion}
            onGrams={controller.chooseGrams}
          />
        </div>
        {active?.food && (
          <PortionSheet
            key={active.key}
            item={active}
            onPortion={(index) => {
              controller.choosePortion(active.key, index);
            }}
            onGrams={(grams) => {
              controller.chooseGrams(active.key, grams);
            }}
          />
        )}
        <TimeField controller={controller} at={at} timeZone={timeZone} />
        <PhotoField controller={controller} />
        <Bolus controller={controller} timeZone={timeZone} simpleMode={simpleMode} />
      </div>
      <div className={styles.confirmFooter}>
        <TotalBar
          total={controller.total}
          actionLabel={t("save")}
          onAction={() => void controller.save()}
          disabled={!controller.complete || controller.saving}
        />
      </div>
    </div>
  );
}
