"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { Icon } from "./icons";
import { isActive, phoneItems, type ShellVariant } from "./nav";
import styles from "./shell.module.css";

/** The bottom tab bar under 1280 px: five tabs, three in simpleMode, three for a viewer. */
export function PhoneTabs({
  locale,
  variant,
  path,
}: {
  locale: AppLocale;
  variant: ShellVariant;
  path: string;
}) {
  const t = useTranslations("nav");
  const iconSize = variant === "simple" ? 32 : 26;
  return (
    <nav className={styles.tabs} aria-label={t("main")} data-testid="phone-tabs">
      {phoneItems(variant).map((item) => (
        <Link
          key={item.href}
          href={localeHref(locale, item.href)}
          className={styles.tab}
          aria-current={isActive(path, item.href) ? "page" : undefined}
        >
          <Icon name={item.icon} size={iconSize} />
          <span>{t(item.label)}</span>
        </Link>
      ))}
    </nav>
  );
}
