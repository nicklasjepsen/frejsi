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
  const fixed = layout === "phone" ? PHONE : DESKTOP;
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
      {origins.map((origin) => (
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
