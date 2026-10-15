import type { Role } from "@frejsi/shared";

import type { Messages } from "@/lib/i18n/messages";

export type ShellVariant = "normal" | "simple" | "viewer";

/** The element at the end of the phone header that `HeaderSlot` renders into. */
export const HEADER_END_ID = "shell-header-end";

export type NavIcon =
  "now" | "plus" | "book" | "clock" | "dots" | "people" | "settings" | "ask" | "calendar";

type NavKey = keyof Messages["nav"];

export interface NavItem {
  /** The message key under `nav` for the phone label. */
  label: NavKey;
  /** The message key for the sidebar label when it differs from the phone's (Måltid → Log et måltid). */
  sidebarLabel?: NavKey;
  /** Path without the locale prefix. */
  href: string;
  /** Sidebar destination when its default differs from the phone tab. */
  sidebarHref?: string;
  /** Shared navigation section for active state across day and week. */
  activeHref?: string;
  icon: NavIcon;
  /** Desktop shortcut, shown as a hint and bound on keydown (normal mode only). */
  shortcut?: string;
}

/** The variant: a viewer gets the viewer shell whatever else is set (§2: no glucose). */
export function shellVariant(role: Role, simpleMode: boolean): ShellVariant {
  if (role === "viewer") return "viewer";
  return simpleMode ? "simple" : "normal";
}

/** Five phone tabs (Main) / six sidebar items (Nu-Desktop); History opens the day on phone and the week on desktop. */
const NORMAL: NavItem[] = [
  { label: "now", href: "/now", icon: "now", shortcut: "N" },
  { label: "meal", sidebarLabel: "logMeal", href: "/log", icon: "plus", shortcut: "M" },
  { label: "food", sidebarLabel: "library", href: "/library", icon: "book", shortcut: "B" },
  {
    label: "history",
    href: "/history",
    sidebarHref: "/history/week",
    activeHref: "/history",
    icon: "clock",
    shortcut: "H",
  },
  { label: "people", href: "/people", icon: "people", shortcut: "P" },
  { label: "more", sidebarLabel: "settings", href: "/settings", icon: "settings", shortcut: "," },
];

/** Three tabs (Nu-Simpel); no settings: the child cannot reach them. Spørg waits for v0.4.0. */
const SIMPLE: NavItem[] = [
  { label: "now", href: "/now", icon: "now" },
  { label: "myFood", href: "/eat", icon: "book" },
  { label: "ask", sidebarLabel: "askAdult", href: "/soon/ask", icon: "ask" },
];

/** Three tabs (Historik-Viewer): never Nu, Måltid or Mad. Tidligere dage opens meal-only history. */
const VIEWER: NavItem[] = [
  { label: "today", href: "/today", icon: "clock" },
  { label: "earlierDays", href: "/history", icon: "calendar" },
  { label: "more", sidebarLabel: "settings", href: "/settings", icon: "dots" },
];

/** The phone tab bar: Personer is reached from Mere on the phone, so it is not a tab. */
export function phoneItems(variant: ShellVariant): NavItem[] {
  if (variant === "simple") return SIMPLE;
  if (variant === "viewer") return VIEWER;
  return NORMAL.filter((item) => item.label !== "people").map((item) =>
    item.label === "more" ? { ...item, icon: "dots" } : item,
  );
}

export function sidebarItems(variant: ShellVariant): NavItem[] {
  if (variant === "simple") return SIMPLE;
  if (variant === "viewer") return VIEWER;
  return NORMAL.map((item) => (item.sidebarHref ? { ...item, href: item.sidebarHref } : item));
}

/** Where a role lands: viewers on their day, everyone else on Nu. */
export function homePath(role: Role): string {
  return role === "viewer" ? "/today" : "/now";
}

/**
 * Screens drawn without the phone header and tab bar: every simpleMode sub-screen has a close
 * button instead (design README "Navigation model"), and the picker is one of them.
 */
export function isChromeless(path: string): boolean {
  return path === "/eat" || path.startsWith("/eat/");
}

/** Active when the path is the item's path or below it. */
export function isActive(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}
