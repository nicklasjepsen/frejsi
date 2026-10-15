import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { LogScreen } from "./LogScreen";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * Log et måltid. A viewer never logs and never sees glucose, so they land on their own day; a
 * simpleMode session gets the picker (`eat`), which shows verified foods only (§2), with or
 * without `?meal=`. `?q=` and `?barcode=` (from the Now header) run the lookup on load; `?meal=`
 * reopens a saved meal for correction (decision 29).
 */
export default async function LogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const locale = resolveLocale((await params).locale);
  const [session, shell, query] = await Promise.all([getShellSession(), getShell(), searchParams]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  if (session.simpleMode) redirect(localeHref(locale, "/eat"));
  return (
    <LogScreen
      spaceId={shell.space.id}
      locale={locale}
      timeZone={shell.space.timezone}
      userName={session.name}
      simpleMode={session.simpleMode}
      initialQuery={one(query.q)}
      initialBarcode={one(query.barcode)}
      mealId={one(query.meal)}
    />
  );
}
