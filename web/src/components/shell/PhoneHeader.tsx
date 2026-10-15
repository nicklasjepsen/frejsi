"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/Avatar";
import type { AppLocale } from "@/lib/i18n/routing";

import { SpaceSwitcher } from "./SpaceSwitcher";
import { HEADER_END_ID, type ShellVariant } from "./nav";
import styles from "./shell.module.css";

/**
 * The phone header (Main, Nu-Simpel, Historik-Viewer): the subject's avatar and name, or
 * "Hej {name}" in simpleMode, and at the end the viewer pill or a slot a page fills through
 * `HeaderSlot` (the source status on Nu).
 */
export function PhoneHeader({
  locale,
  variant,
  user,
  space,
  spaces,
}: {
  locale: AppLocale;
  variant: ShellVariant;
  user: { name: string };
  space: { id: string; name: string; role: Role; subjectName: string };
  spaces: { id: string; name: string; role: Role }[];
}) {
  const t = useTranslations("shell");
  return (
    <header className={styles.phoneHeader} data-testid="phone-header">
      {variant === "simple" ? (
        <div className={styles.phoneHeaderName}>
          <Avatar name={user.name} size={48} />
          <h2 className={styles.subjectName}>{t("greeting", { name: user.name })}</h2>
        </div>
      ) : spaces.length > 1 ? (
        <SpaceSwitcher locale={locale} current={space} spaces={spaces} compact />
      ) : (
        <div className={styles.phoneHeaderName}>
          <Avatar name={space.subjectName} size={36} />
          <h2 className={styles.subjectName}>{space.subjectName}</h2>
        </div>
      )}
      <div className={styles.headerEnd} id={HEADER_END_ID} data-testid={HEADER_END_ID}>
        {variant === "viewer" && <span className={styles.viewerPill}>{t("viewerPill")}</span>}
      </div>
    </header>
  );
}
