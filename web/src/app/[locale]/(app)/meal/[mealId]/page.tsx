import { prisma } from "@frejsi/shared";
import { redirect } from "next/navigation";

import { MealDetail, SimpleMealView } from "@/components/meal-detail";
import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { loadSpaceUnit } from "./space-unit";

/**
 * Måltid. The `(app)` layout has checked the session and `getShell` shares its load. A viewer
 * never sees glucose, so they are sent to their own day before anything is read (the curve route
 * refuses them too); a simpleMode session gets the calm view without the curve (decision 9).
 * `?edit=1` opens the detail with its edit sheet for an owner or carer (the rows' "Ret", v0.6.0
 * task 8); the viewer's redirect and the simple view come first and ignore it.
 */
export default async function MealPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; mealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, mealId } = await params;
  const locale = resolveLocale(raw);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  if (session.simpleMode) {
    return (
      <SimpleMealView
        key={`${shell.space.id}:${mealId}`}
        spaceId={shell.space.id}
        mealId={mealId}
        locale={locale}
        timeZone={shell.space.timezone}
      />
    );
  }
  const aiEnabled =
    (await prisma.space.findUnique({ where: { id: shell.space.id }, select: { aiEnabled: true } }))
      ?.aiEnabled ?? false;
  const edit = (await searchParams)?.edit === "1";
  return (
    <MealDetail
      aiEnabled={aiEnabled}
      edit={edit}
      key={`${shell.space.id}:${mealId}`}
      spaceId={shell.space.id}
      mealId={mealId}
      locale={locale}
      timeZone={shell.space.timezone}
      unit={await loadSpaceUnit(shell.space.id)}
    />
  );
}
