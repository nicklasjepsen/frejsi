import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { SimplePicker } from "@/components/simple/SimplePicker";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Hvad spiser du? (`eat`, Log-Simpel): the picker over the space's verified foods. The `(app)`
 * layout has checked the session and `getShell` shares its load. A viewer never logs a meal, so
 * they land on their day; every other session gets the picker, at the large sizes in simpleMode.
 * `?food=<id>` (a "Min mad" tile on Nu) arrives with that food selected.
 */
export default async function EatPage({
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
  const food = typeof query.food === "string" && query.food !== "" ? query.food : undefined;
  return (
    <SimplePicker
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      simple={session.simpleMode}
      initialFoodId={food}
    />
  );
}
