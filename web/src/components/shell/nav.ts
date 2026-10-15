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
  icon: NavIcon;
  /** Desktop shortcut, shown as a hint and bound on keydown (normal mode only). */
  shortcut?: string;
}

/** The variant: a viewer gets the viewer shell whatever else is set (§2: no glucose). */
export function shellVariant(role: Role, simpleMode: boolean): ShellVariant {
  if (role === "viewer") return "viewer";
  return simpleMode ? "simple" : "normal";
}

/** Five phone tabs (Main) / six sidebar items (Nu-Desktop); unbuilt ones open the placeholder. */
const NORMAL: NavItem[] = [
  { label: "now", href: "/now", icon: "now", shortcut: "N" },
  { label: "meal", sidebarLabel: "logMeal", href: "/soon/meals", icon: "plus", shortcut: "M" },
  { label: "food", sidebarLabel: "library", href: "/soon/food", icon: "book", shortcut: "B" },
  { label: "history", href: "/soon/history", icon: "clock", shortcut: "H" },
  { label: "people", href: "/people", icon: "people", shortcut: "P" },
  { label: "more", sidebarLabel: "settings", href: "/settings", icon: "settings", shortcut: "," },
];

/** Three tabs (Nu-Simpel); no settings: the child cannot reach them. */
const SIMPLE: NavItem[] = [
  { label: "now", href: "/now", icon: "now" },
  { label: "myFood", href: "/soon/my-food", icon: "book" },
  { label: "ask", sidebarLabel: "askAdult", href: "/soon/ask", icon: "ask" },
];

/** Three tabs (Historik-Viewer): never Nu, Måltid or Mad. */
const VIEWER: NavItem[] = [
  { label: "today", href: "/soon/today", icon: "clock" },
  { label: "earlierDays", href: "/soon/earlier-days", icon: "calendar" },
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
  return NORMAL;
}

/** Where a role lands: viewers on their day, everyone else on Nu. */
export function homePath(role: Role): string {
  return role === "viewer" ? "/soon/today" : "/now";
}

/** Active when the path is the item's path or below it. */
export function isActive(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}
