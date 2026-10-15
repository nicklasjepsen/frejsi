"use client";
import { Badge } from "../ui/Badge";
import theme from "../ui/food-ui.module.css";
import { FoodPhoto } from "./FoodPhoto";
import styles from "./food.module.css";

interface Props {
  title: string;
  subtitle?: string;
  thumbUrl?: string;
  verified: boolean;
  selected?: boolean;
  size?: 92 | 104 | 112 | 140;
  onClick?: () => void;
  disabled?: boolean;
}
export function PhotoTile({
  title,
  subtitle,
  thumbUrl,
  verified,
  selected = false,
  size = 104,
  onClick,
  disabled,
}: Props) {
  return (
    <button
      type="button"
      className={`${theme.theme} ${styles.tile}`}
      data-size={size}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
    >
      <div className={styles.tileImage} style={{ height: size }}>
        <FoodPhoto src={thumbUrl} />
        {selected && (
          <span data-testid="selection-check" className={styles.selectionCheck} aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      <span className={styles.tileTitle}>{title}</span>
      {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      {!verified && <Badge verified={false} />}
    </button>
  );
}
