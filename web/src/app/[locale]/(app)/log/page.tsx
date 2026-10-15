import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { LogScreen } from "./LogScreen";

type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** Log a new meal. Old edit links go to detail; role and simpleMode gates run first. */
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
  const mealId = one(query.meal);
  if (mealId) redirect(localeHref(locale, `/meal/${encodeURIComponent(mealId)}`));
  return (
    <LogScreen
      spaceId={shell.space.id}
      locale={locale}
      timeZone={shell.space.timezone}
      userName={session.name}
      simpleMode={session.simpleMode}
      initialQuery={one(query.q)}
      initialBarcode={one(query.barcode)}
    />
  );
}
