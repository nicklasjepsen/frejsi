import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { SymptomPicker } from "@/components/symptoms/SymptomPicker";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * Jeg har det… (`feel`, plan §5): the symptom picker. A viewer never logs, so they land on
 * their day; every other session gets the picker, tiles only at the large sizes in simpleMode.
 */
export default async function FeelPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  return (
    <SymptomPicker
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      simple={session.simpleMode}
      timeZone={shell.space.timezone}
    />
  );
}
