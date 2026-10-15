import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./food-ui.module.css";

export function QuickLinkCard({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
}) {
  return (
    <Link href={href} className={styles.quickLink}>
      {icon && (
        <span className={styles.quickIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span>
        <strong>{title}</strong>
        {subtitle && <span className={styles.secondary}>{subtitle}</span>}
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
