"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "./Badge";
import styles from "./food-ui.module.css";

interface Props {
  title: string;
  verified: boolean;
  secondary?: ReactNode;
  photo?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  thumbSize?: 44 | 52;
  variant?: "food";
}
export function ListRow({
  title,
  verified,
  secondary,
  photo,
  trailing,
  href,
  onClick,
  thumbSize = 44,
}: Props) {
  return (
    <div className={styles.listRow}>
      {photo && (
        <div className={styles.thumb} style={{ width: thumbSize, height: thumbSize }}>
          {photo}
        </div>
      )}
      <div className={styles.rowBody}>
        {href ? (
          <Link className={styles.foodTitle} href={href}>
            {title}
          </Link>
        ) : onClick ? (
          <button type="button" className={styles.foodTitle} onClick={onClick}>
            {title}
          </button>
        ) : (
          <span className={styles.foodTitle}>{title}</span>
        )}
        {secondary && <div className={styles.secondary}>{secondary}</div>}
        {!verified && <Badge verified={false} />}
      </div>
      {trailing}
    </div>
  );
}
