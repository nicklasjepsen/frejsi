"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

/**
 * "Jeg har det…": the way to the picker from Now, under "Log et måltid" on the phone and under
 * "Jeg spiser nu" in simpleMode (plan §5; the curve lane mounts it). A link, so it works before
 * hydration and with the keyboard.
 */
export function FeelButton({ locale, simple = false }: { locale: AppLocale; simple?: boolean }) {
  const t = useTranslations("symptoms");
  return (
    <Button href={localeHref(locale, "/feel")} variant="secondary" size={simple ? "simple" : "phone"}>
      {t("nav")}
    </Button>
  );
}
