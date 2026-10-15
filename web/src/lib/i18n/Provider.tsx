"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import type { Messages } from "./messages";
import type { AppLocale } from "./routing";

/**
 * The client provider, re-exported from a client module so that server layouts render the plain
 * provider with explicit `locale` and `messages`. The server variant of `NextIntlClientProvider`
 * would look for a request config, which this app does not use (no `next-intl` plugin: the
 * messages are loaded by the `[locale]` layout and every string is rendered by a client
 * component).
 */
export function I18nProvider({
  locale,
  messages,
  timeZone,
  children,
}: {
  locale: AppLocale;
  messages: Messages;
  timeZone?: string;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} {...(timeZone ? { timeZone } : {})}>
      {children}
    </NextIntlClientProvider>
  );
}
