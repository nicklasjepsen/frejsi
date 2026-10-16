"use client";
import { useSyncExternalStore } from "react";

import type { AppLocale } from "@/lib/i18n/routing";

import { useLogController } from "./controller";
import { DesktopLog } from "./DesktopLog";
import { PhoneLog } from "./PhoneLog";
import { usePhoneView } from "./phone-view";

export interface LogScreenProps {
  spaceId: string;
  locale: AppLocale;
  timeZone: string;
  userName: string;
  /** simpleMode sessions are redirected to `eat` by the page; the bolus tap is never shown to one. */
  simpleMode: boolean;
  initialQuery?: string | undefined;
  initialBarcode?: string | undefined;
  /** Forces a layout (tests); otherwise 1280 px and up is desktop, as in the shell. */
  layout?: "phone" | "desktop";
}

const DESKTOP = "(min-width: 1280px)";

function useDesktop(forced?: "phone" | "desktop"): boolean {
  const matches = useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(DESKTOP);
      query.addEventListener("change", notify);
      return () => {
        query.removeEventListener("change", notify);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP).matches,
    () => false,
  );
  return forced ? forced === "desktop" : matches;
}

/**
 * Log et måltid (Log-Telefon, Log-Portioner, Log-Desktop). One controller holds the meal being
 * built; the phone and desktop layouts render it.
 */
export function LogScreen(props: LogScreenProps) {
  const desktop = useDesktop(props.layout);
  const phone = usePhoneView("entry");
  const controller = useLogController({
    spaceId: props.spaceId,
    simpleMode: props.simpleMode,
    locale: props.locale,
    initialQuery: props.initialQuery,
    initialBarcode: props.initialBarcode,
    onAdded: () => {
      phone.setView("confirm");
    },
  });
  return desktop ? (
    <DesktopLog {...props} controller={controller} />
  ) : (
    <PhoneLog {...props} controller={controller} phone={phone} />
  );
}
