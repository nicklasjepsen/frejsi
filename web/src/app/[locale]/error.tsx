"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { localeHref, stripLocale } from "@/lib/i18n/routing";

/**
 * A kind page in the user's language when a screen fails (plan §9): no stack, no message from the
 * error, which could carry request data. Server-side errors reach App Insights through
 * instrumentation.ts.
 */
export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors.page");
  const locale = stripLocale(usePathname()).locale ?? "da";
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
