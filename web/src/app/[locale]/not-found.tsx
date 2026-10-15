"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { localeHref, stripLocale } from "@/lib/i18n/routing";

/** The page for a path that does not exist, in the user's language, with one way home. */
export default function LocaleNotFound() {
  const t = useTranslations("errors.notFound");
  const locale = stripLocale(usePathname()).locale ?? "da";
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: 28 }}>{t("title")}</h1>
      <p style={{ color: "var(--text-muted)", margin: "8px 0 20px" }}>{t("body")}</p>
      <Button href={localeHref(locale, "/")} variant="secondary">
        {t("home")}
      </Button>
    </main>
  );
}
