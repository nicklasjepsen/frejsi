"use client";
import { useTranslations } from "next-intl";

import { FoodPhoto } from "../food/FoodPhoto";
import { Badge } from "../ui/Badge";
import { itemCarbs, itemGrams, portionLabel, type DraftItem } from "./draft";
import styles from "./meal.module.css";
import { PortionSheet } from "./PortionSheet";
import { useSourceLine } from "./source-line";

/**
 * The items of the meal being built (Log-Portioner card, Log-Desktop meal column): photo, name,
 * the per-100 g line with the badge, the chosen portion and its carbs. The active item is the one
 * the portion sheet is for; on desktop every item carries its chips inline.
 */
export function MealItems({
  items,
  activeKey,
  onSelect,
  onRemove,
  onPortion,
  onGrams,
  desktop = false,
}: {
  items: DraftItem[];
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  onRemove: (key: string) => void;
  onPortion: (key: string, index: number) => void;
  onGrams: (key: string, grams: number | null) => void;
  desktop?: boolean;
}) {
  const t = useTranslations("log");
  const say = useTranslations("say");
  const { per100g, format } = useSourceLine();
  return (
    <ul className={styles.items} role="list" data-testid="meal-items">
      {items.map((item) => {
        const carbs = itemCarbs(item);
        const label = portionLabel(item);
        const grams = itemGrams(item);
        const detail =
          label ?? (grams !== undefined ? `${format(grams, 0)} g` : null) ?? t("choosePortion");
        const perLine = item.food ? per100g(item.food) : null;
        return (
          <li
            key={item.key}
            className={styles.item}
            data-active={activeKey === item.key ? "true" : undefined}
            data-testid={`meal-item-${item.key}`}
          >
            <div className={styles.itemRow}>
              <div className={styles.itemThumb}>
                <FoodPhoto src={item.food?.photo?.thumbUrl} />
              </div>
              <button
                type="button"
                className={styles.itemBody}
                onClick={() => onSelect?.(item.key)}
                disabled={!onSelect || !item.food}
              >
                <span className={styles.itemName}>
                  {item.approx
                    ? say("estimate", { name: item.name, carbs: carbs ?? 0 })
                    : item.name}
                </span>
                {item.approx && (
                  <span className={styles.itemMeta}>
                    {say("guess")}
                    {item.confidence === "low" ? ` · ${say("uncertain")}` : ""}
                  </span>
                )}
                <span className={styles.itemMeta}>
                  {perLine && <span>{perLine}</span>}
                  {item.food && !item.food.verified && <Badge verified={false} />}
                </span>
                {(!desktop || !item.food) && <span className={styles.itemMeta}>{detail}</span>}
              </button>
              <span className={styles.itemCarbs} data-zero={carbs === 0 ? "true" : undefined}>
                {carbs === null ? "–" : t("totalAmount", { amount: format(carbs, 0) })}
              </span>
              <button
                type="button"
                className={styles.removeButton}
                aria-label={t("remove", { name: item.name })}
                onClick={() => {
                  onRemove(item.key);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {desktop && item.food && (
              <PortionSheet
                item={item}
                desktop
                onPortion={(index) => {
                  onPortion(item.key, index);
                }}
                onGrams={(value) => {
                  onGrams(item.key, value);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
