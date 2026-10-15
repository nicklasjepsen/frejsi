import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getShellSession } from "@/components/shell/shell-session";
import { getMessages } from "@/lib/i18n/messages";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { Welcome } from "./Welcome";

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  return { title: getMessages(locale).welcome.pageTitle };
}

/**
 * `/[locale]/welcome` is reachable without a session (plan §6): the middleware lets it through
 * and this page asks for nothing. Someone who is already signed in has no use for it and goes to
 * the front page, which lands on their home.
 */
export default async function WelcomePage({ params }: { params: Params }) {
  const locale = resolveLocale((await params).locale);
  if (await getShellSession()) redirect(localeHref(locale, "/"));
  return <Welcome locale={locale} />;
}
