"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { SearchField } from "@/components/food/SearchField";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { logTarget } from "./log-target";

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * The Nu-Desktop header field "Søg mad eller skriv en stregkode" with the kbd `/`: `/` focuses it
 * from anywhere on the page (not while typing elsewhere), Enter opens the log screen with the
 * search or the barcode, where the lookup runs.
 */
export function NowSearch({ locale }: { locale: AppLocale }) {
  const t = useTranslations("eat.now");
  const router = useRouter();
  const [value, setValue] = useState("");
  const id = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable))
        return;
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [id]);

  return (
    <SearchField
      id={id}
      label={t("searchLabel")}
      placeholder={t("searchLabel")}
      value={value}
      onChange={setValue}
      shortcut="/"
      onSubmit={(text) => {
        const target = logTarget(text);
        if (target) router.push(localeHref(locale, target));
      }}
    />
  );
}
