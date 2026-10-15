"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./food-ui.module.css";
import nav from "./nav-ui.module.css";

export type PageHeaderProps =
  | {
      variant?: "default";
      title: string;
      subtitle?: string;
      onBack?: () => void;
      onClose?: () => void;
      simple?: boolean;
      trailing?: ReactNode;
    }
  | {
      /**
       * Maaltid-Telefon: a 44 px back, a centred 14 px muted line ("I dag 12:10 · Jonas") and a
       * trailing 15 px link ("Ret"). The screen carries its own h1 below it.
       */
      variant: "meta";
      meta: string;
      backHref?: string;
      onBack?: () => void;
      trailing?: ReactNode;
    };

export function PageHeader(props: PageHeaderProps) {
  if (props.variant === "meta") return <MetaHeader {...props} />;
  return <DefaultHeader {...props} />;
}

function MetaHeader({
  meta,
  backHref,
  onBack,
  trailing,
}: Extract<PageHeaderProps, { variant: "meta" }>) {
  const t = useTranslations("foodKit");
  const glyph = <span aria-hidden="true">←</span>;
  return (
    <header className={nav.metaHeader} data-variant="meta">
      {backHref !== undefined ? (
        <Link href={backHref} className={nav.metaBack} aria-label={t("back")}>
          {glyph}
        </Link>
      ) : onBack ? (
        <button type="button" className={nav.metaBack} aria-label={t("back")} onClick={onBack}>
          {glyph}
        </button>
      ) : (
        <span className={nav.metaBack} aria-hidden="true" />
      )}
      <p className={nav.metaLine} data-part="meta">
        {meta}
      </p>
      <div className={nav.metaTrailing}>{trailing}</div>
    </header>
  );
}

function DefaultHeader({
  title,
  subtitle,
  onBack,
  onClose,
  simple = false,
  trailing,
}: Exclude<PageHeaderProps, { variant: "meta" }>) {
  const t = useTranslations("foodKit");
  return (
    <header
      className={styles.pageHeader}
      data-simple={simple}
      data-navigation={Boolean(onBack ?? onClose)}
    >
      {(onBack ?? onClose) && (
        <button
          className={styles.headerNavigation}
          type="button"
          onClick={onClose ?? onBack}
          aria-label={t(onClose ? "close" : "back")}
        >
          <span aria-hidden="true">{onClose ? "×" : "←"}</span>
        </button>
      )}
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={styles.headerTrailing}>{trailing}</div>
    </header>
  );
}
