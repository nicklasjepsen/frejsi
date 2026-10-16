"use client";

import type { Theme } from "@frejsi/shared/schemas/settings";
import { useEffect } from "react";

import { applyTheme, documentTheme } from "@/lib/theme/theme";

/**
 * Keeps the device on the signed-in person's stored theme. The root layout paints from the
 * `frejsi_theme` cookie; on a device that has no cookie yet (a session opened before the setting
 * existed, or a cookie that was cleared) this applies the stored value once the shell is up, and
 * writes the cookie so the next load paints right from the start. Nothing is written when the
 * two already agree.
 */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    if (documentTheme() !== theme) applyTheme(theme);
  }, [theme]);
  return null;
}
