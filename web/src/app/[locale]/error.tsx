"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { localeHref, resolveLocale, stripLocale } from "@/lib/i18n/routing";

/**
 * A kind page in the user's language when a screen fails (plan §9): no stack, no message from the
 * error, which could carry request data. Server-side errors reach App Insights through
 * instrumentation.ts.
 */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors.page");
  // The provider's locale is the URL's, validated by the layout; no literal default here.
  const providerLocale = resolveLocale(useLocale());
  const locale = stripLocale(usePathname()).locale ?? providerLocale;
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px" }}>
      <h1 style={{ fontSize: 28 }}>{t("title")}</h1>
      <p style={{ color: "var(--text-muted)", margin: "8px 0 20px" }}>{t("body")}</p>
      <div style={{ display: "flex", gap: 10 }}>
        <Button onClick={reset}>{t("retry")}</Button>
        <Button href={localeHref(locale, "/")} variant="secondary">
          {t("home")}
        </Button>
      </div>
    </main>
  );
}
