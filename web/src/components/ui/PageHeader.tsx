"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BackButton } from "./BackButton";
import styles from "./food-ui.module.css";
import nav from "./nav-ui.module.css";

export type PageHeaderProps =
  | {
      variant?: "default";
      title: string;
      /** An id for the h1, so a form or region on the page can be named by it. */
      titleId?: string;
      subtitle?: string;
      onBack?: () => void;
      onClose?: () => void;
      simple?: boolean;
      trailing?: ReactNode;
    }
  | {
      /**
       * Maaltid-Telefon: a 48 px back (BackButton), a centred 14 px muted line ("I dag 12:10 ·
       * Jonas") and a trailing 15 px link ("Ret"). The screen carries its own h1 below it.
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
  return (
    <header className={nav.metaHeader} data-variant="meta">
      {backHref !== undefined ? (
        <BackButton href={backHref} label={t("back")} />
      ) : onBack ? (
        <BackButton onClick={onBack} label={t("back")} />
      ) : (
        <span className={nav.metaSpacer} aria-hidden="true" />
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
  titleId,
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
      {onClose ? (
        <button
          className={styles.headerNavigation}
          type="button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : (
        onBack && (
          <BackButton onClick={onBack} label={t("back")} size={simple ? "simple" : "normal"} />
        )
      )}
      <div>
        <h1 id={titleId}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={styles.headerTrailing}>{trailing}</div>
    </header>
  );
}
