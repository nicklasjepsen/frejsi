"use client";

import type { Accent, Role } from "@frejsi/shared";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { SettingsLiveRefresh } from "@/components/settings/SettingsLiveRefresh";
import { stripLocale, type AppLocale } from "@/lib/i18n/routing";

import { PhoneHeader } from "./PhoneHeader";
import { PhoneTabs } from "./PhoneTabs";
import { Sidebar } from "./Sidebar";
import { isChromeless, shellVariant } from "./nav";
import styles from "./shell.module.css";

export interface AppShellProps {
  locale: AppLocale;
  user: { name: string; accent: Accent; simpleMode: boolean };
  space: {
    id: string;
    name: string;
    role: Role;
    subjectName: string;
    ownerName: string | null;
    aiEnabled?: boolean;
  };
  spaces: { id: string; name: string; role: Role }[];
  children?: ReactNode;
}

/**
 * The shell around every signed-in screen (design README "Navigation model"): under 1280 px a
 * phone header and bottom tabs, from 1280 px a sidebar; normal, simpleMode and viewer variants.
 * Both navs are in the DOM and CSS shows one, so the server renders the right thing without
 * knowing the viewport. `data-accent` switches the accent variables for everything inside.
 */
export function AppShell({ locale, user, space, spaces, children }: AppShellProps) {
  const variant = shellVariant(space.role, user.simpleMode);
  const path = stripLocale(usePathname()).path;
  // The picker has its own 48 px close and no tab bar on the phone; the desktop sidebar stays.
  const chromeless = isChromeless(path);
  return (
    <div
      className={styles.shell}
      data-variant={variant}
      data-accent={user.accent}
      data-testid="app-shell"
    >
      {variant === "simple" && <SettingsLiveRefresh spaceId={space.id} />}
      <Sidebar
        locale={locale}
        variant={variant}
        path={path}
        user={user}
        space={space}
        spaces={spaces}
      />
      <div className={styles.main}>
        {!chromeless && (
          <PhoneHeader
            locale={locale}
            variant={variant}
            user={user}
            space={space}
            spaces={spaces}
          />
        )}
        <main>{children}</main>
      </div>
      {!chromeless && (
        <PhoneTabs
          locale={locale}
          variant={variant}
          path={path}
          aiEnabled={space.aiEnabled ?? false}
        />
      )}
    </div>
  );
}
