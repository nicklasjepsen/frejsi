"use client";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";
import styles from "./food.module.css";

export function FoodPhoto({
  src,
  alt = "",
  size,
}: {
  src?: string | undefined;
  alt?: string;
  size?: number;
}) {
  const t = useTranslations("foodKit");
  const [failedSrc, setFailedSrc] = useState<string>();
  const dimensions: CSSProperties = size === undefined ? {} : { width: size, height: size };
  return src && src !== failedSrc ? (
    <img
      className={styles.photo}
      style={dimensions}
      src={src}
      alt={alt}
      onError={() => {
        setFailedSrc(src);
      }}
    />
  ) : (
    <span
      className={styles.placeholder}
      style={dimensions}
      role="img"
      aria-label={alt || t("photo")}
    >
      {t("photo")}
    </span>
  );
}
