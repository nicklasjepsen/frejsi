"use client";
import { useTranslations } from "next-intl";

import { Chip } from "@/components/ui";

import type { FixedFilter, LibraryFilter } from "./api-client";
import { useFoodText } from "./format";
import styles from "./library.module.css";

/** The phone draws all of these; the desktop artboard only Alle, Ikke tjekket and Egne retter. */
const PHONE: readonly FixedFilter[] = ["all", "unverified", "own", "favourites", "recent"];
const DESKTOP: readonly FixedFilter[] = ["all", "unverified", "own"];

/**
 * The filter chips (Bibliotek-Telefon, Bibliotek-Desktop): the fixed filters, then one chip per
 * origin present in the space ("Fra Open Food Facts", "Fra Frida"). "Ikke tjekket · 3" uses the
 * terracotta pair.
 */
export function LibraryFilters({
  value,
  onChange,
  origins,
  unverified,
  layout,
}: {
  value: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
  origins: readonly string[];
  unverified: number;
  layout: "phone" | "desktop";
}) {
  const t = useTranslations("library");
  const text = useFoodText();
  // A deep-linked filter stays visible even when the artboard normally omits its chip.
  const fixed = PHONE.filter(
    (filter) => layout === "phone" || DESKTOP.includes(filter) || filter === value,
  );
  const activeOrigin = !PHONE.some((filter) => filter === value) && !origins.includes(value);
  const visibleOrigins = activeOrigin ? [...origins, value] : origins;
  return (
    <div className={styles.filters} role="group" aria-label={t("filters")}>
      {fixed.map((filter) => (
        <Chip
          key={filter}
          pressed={value === filter}
          variant={filter === "unverified" ? "unverified" : "default"}
          onClick={() => {
            onChange(filter);
          }}
        >
          {filter === "unverified"
            ? t("filter.unverified", { count: unverified })
            : t(`filter.${filter}`)}
        </Chip>
      ))}
      {visibleOrigins.map((origin) => (
        <Chip
          key={origin}
          pressed={value === origin}
          onClick={() => {
            onChange(origin);
          }}
        >
          {text.originFilter(origin)}
        </Chip>
      ))}
    </div>
  );
}
