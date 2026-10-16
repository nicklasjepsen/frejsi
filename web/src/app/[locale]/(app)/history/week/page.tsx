import { prisma } from "@frejsi/shared";
import { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { redirect } from "next/navigation";
import { HistoryWeekScreen } from "@/components/history-week/HistoryWeekScreen";
import { selectedWeek } from "@/components/history-week/dates";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

export default async function HistoryWeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ start?: string | string[]; view?: string | string[] }>;
}) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, "/history"));
  if (session.simpleMode) redirect(localeHref(locale, "/now"));
  const query = await searchParams;
  const start = selectedWeek(
    typeof query.start === "string" ? query.start : undefined,
    shell.space.timezone,
    new Date(),
  );
  // The event-only feed has no settings snapshot. Read the display preference on the server;
  // no extra space route or glucose window is needed to render the week's table.
  const space = await prisma.space.findUnique({
    where: { id: shell.space.id },
    select: { glucoseUnit: true, aiEnabled: true },
  });
  const unit = GlucoseUnit.parse(space?.glucoseUnit ?? "mmol");
  return (
    <HistoryWeekScreen
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      unit={unit}
      aiEnabled={space?.aiEnabled ?? false}
      start={start}
      view={query.view === "maaltider" ? "maaltider" : "uge"}
    />
  );
}
