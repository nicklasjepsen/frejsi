"use client";
import { useLocale, useTranslations } from "next-intl";
import { Chip } from "../ui/Chip";
import { NumberInput } from "../ui/NumberInput";
import styles from "./food.module.css";

export interface PortionChoice {
  label: string;
  carbs: number;
  grams?: number;
}
interface Props {
  portions: readonly PortionChoice[];
  carbsPer100g?: number | null;
  selectedIndex?: number;
  onSelect: (portion: PortionChoice) => void;
  onWeigh?: () => void;
  grams?: number;
  onGramsChange?: (grams: number | undefined) => void;
  desktop?: boolean;
}
export function PortionChips({
  portions,
  carbsPer100g,
  selectedIndex,
  onSelect,
  onWeigh,
  grams,
  onGramsChange,
  desktop = false,
}: Props) {
  const t = useTranslations("foodKit");
  const locale = useLocale();
  const canWeigh = carbsPer100g !== undefined && carbsPer100g !== null;
  return (
    <div className={styles.portions}>
      {portions.map((portion, index) => (
        <Chip
          key={`${index}-${portion.label}`}
          className={styles.portion}
          pressed={selectedIndex === index}
          onClick={() => {
            onSelect(portion);
          }}
        >
          {t("portion", {
            label: portion.label,
            amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
              portion.carbs,
            ),
          })}
        </Chip>
      ))}
      {canWeigh && (
        <Chip className={styles.portion} onClick={onWeigh}>
          {t("weigh")}
        </Chip>
      )}
      {canWeigh && desktop && (
        <div className={styles.grams}>
          <NumberInput
            label={t("grams")}
            value={grams ?? ""}
            min={1}
            max={5000}
            step={1}
            onChange={(event) =>
              onGramsChange?.(
                Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : undefined,
              )
            }
          />
        </div>
      )}
    </div>
  );
}
