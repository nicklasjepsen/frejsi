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
  variant?: "food" | "capture";
  selected?: boolean;
  size?: 92 | 104 | 112 | 140;
  onClick?: () => void;
  disabled?: boolean;
}
export function PhotoTile({
  title,
  variant = "food",
  subtitle,
  thumbUrl,
  verified,
  selected = false,
  size = 104,
  onClick,
  disabled,
}: Props) {
  if (variant === "capture")
    return (
      <button type="button" className={styles.captureTile} onClick={onClick} disabled={disabled}>
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 7h4l2-3h6l2 3h4v13H3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span>{title}</span>
        {subtitle && <span>{subtitle}</span>}
      </button>
    );
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
