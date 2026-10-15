import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { isLocale } from "@/lib/i18n/routing";

/**
 * Validates the locale segment and provides its messages to every client component below. No
 * static params: every page under here depends on the session, so nothing is prerendered.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {children}
    </I18nProvider>
  );
}
