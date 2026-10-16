"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Kbd } from "@/components/ui/Kbd";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { Icon } from "./icons";
import { isActive, sidebarItems, type NavItem, type ShellVariant } from "./nav";
import { SpaceSwitcher } from "./SpaceSwitcher";
import styles from "./shell.module.css";

export interface SidebarProps {
  locale: AppLocale;
  variant: ShellVariant;
  path: string;
  user: { name: string };
  space: {
    id: string;
    name: string;
    role: Role;
    subjectName: string;
    ownerName: string | null;
    aiEnabled?: boolean;
  };
  spaces: { id: string; name: string; role: Role }[];
}

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** N M B H P , jump between the sidebar items; not while typing, not with a modifier. */
function useShortcuts(locale: AppLocale, items: NavItem[], enabled: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable))
        return;
      const item = items.find((i) => i.shortcut?.toLowerCase() === event.key.toLowerCase());
      if (!item) return;
      event.preventDefault();
      router.push(localeHref(locale, item.href));
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [enabled, items, locale, router]);
}

/**
 * The 240 px sidebar from 1280 px (Nu-Desktop): wordmark, space switcher, items with shortcut
 * hints, the user and role. simpleMode: 260 px, headed by the avatar and the person's name, three
 * large items and the footer "Simpel visning · slået til af {owner}" (Nu-Simpel-Desktop).
 */
export function Sidebar({ locale, variant, path, user, space, spaces }: SidebarProps) {
  const t = useTranslations("nav");
  const shell = useTranslations("shell");
  const roles = useTranslations("roles");
  const items = sidebarItems(variant, space.aiEnabled);
  useShortcuts(locale, items, variant === "normal");
  const simple = variant === "simple";

  return (
    <nav className={styles.sidebar} aria-label={t("main")} data-testid="sidebar">
      {simple ? (
        <div className={styles.simpleHead}>
          <Avatar name={user.name} size={48} />
          <h2 className={styles.simpleName}>{user.name}</h2>
        </div>
      ) : (
        <div className={styles.sidebarTop}>
          <div className={styles.wordmark}>Frejsi</div>
          <SpaceSwitcher locale={locale} current={space} spaces={spaces} />
        </div>
      )}

      <div className={styles.sidebarItems}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={localeHref(locale, item.href)}
            className={styles.sidebarItem}
            aria-current={isActive(path, item.activeHref ?? item.href) ? "page" : undefined}
            aria-keyshortcuts={item.shortcut && !simple ? item.shortcut : undefined}
          >
            <Icon name={item.icon} size={simple ? 30 : 22} />
            <span className={styles.sidebarItemLabel} data-testid="label">
              {t(item.sidebarLabel ?? item.label)}
            </span>
            {item.shortcut && !simple && (
              <span className={styles.sidebarHint} role="presentation">
                <Kbd>{item.shortcut}</Kbd>
              </span>
            )}
          </Link>
        ))}
      </div>

      <div className={styles.sidebarSpacer} />

      {simple ? (
        <div className={styles.simpleFooter}>
          {space.ownerName
            ? shell("simpleFooter", { owner: space.ownerName })
            : shell("simpleFooterNoOwner")}
        </div>
      ) : (
        <div className={styles.sidebarFooter}>
          <div className={styles.sidebarUser}>
            <Avatar name={user.name} size={28} tone="owner" />
            <div>
              <div className={styles.sidebarUserName}>{user.name}</div>
              <div className={styles.sidebarUserRole}>{roles(space.role)}</div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
