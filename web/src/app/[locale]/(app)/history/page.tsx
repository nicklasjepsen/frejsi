import { prisma } from "@frejsi/shared";
import { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { redirect } from "next/navigation";

import { localDateOf } from "@/components/day/format";
import { validDate } from "@/components/history/dates";
import { HistoryScreen } from "@/components/history/HistoryScreen";
import { ViewerDays } from "@/components/history/ViewerDays";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (session.simpleMode) redirect(localeHref(locale, "/now"));
  const today = localDateOf(new Date(), shell.space.timezone);
  const date = (await searchParams).date;
  const initialDate = validDate(date, today) ? date : today;
  const props = { spaceId: shell.space.id, locale, today, initialDate };
  if (shell.space.role === "viewer") return <ViewerDays key={shell.space.id} {...props} />;
  // The history contract carries target bounds in mmol; the presentation unit is a space setting.
  // Membership was checked by getShell. No reading query is made during the server render.
  const space = await prisma.space.findUnique({
    where: { id: shell.space.id },
    select: { glucoseUnit: true, aiEnabled: true },
  });
  if (!space) return null;
  return (
    <HistoryScreen
      aiEnabled={space.aiEnabled}
      key={shell.space.id}
      {...props}
      unit={GlucoseUnit.parse(space.glucoseUnit)}
    />
  );
}
