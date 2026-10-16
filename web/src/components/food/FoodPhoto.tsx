"use client";
import { useState, type CSSProperties } from "react";
import styles from "./food.module.css";

/**
 * A food's thumbnail, or a placeholder when it has none (or the image failed): an icon screen
 * readers skip, unless the caller named the picture (a preview), in which case the name stays.
 */
export function FoodPhoto({
  src,
  alt = "",
  size,
}: {
  src?: string | undefined;
  alt?: string;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const dimensions: CSSProperties = size === undefined ? {} : { width: size, height: size };
  if (src && src !== failedSrc)
    return (
      <img
        className={styles.photo}
        style={dimensions}
        src={src}
        alt={alt}
        onError={() => {
          setFailedSrc(src);
        }}
      />
    );
  return alt ? (
    <span className={styles.placeholder} style={dimensions} role="img" aria-label={alt}>
      <PhotoIcon />
    </span>
  ) : (
    <span className={styles.placeholder} style={dimensions} aria-hidden="true">
      <PhotoIcon />
    </span>
  );
}

/** A picture frame with a sun and a hill, sized by the placeholder. */
function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m3.5 17 5-4.5 4 3.5 3-2.5 5 4" />
    </svg>
  );
}
