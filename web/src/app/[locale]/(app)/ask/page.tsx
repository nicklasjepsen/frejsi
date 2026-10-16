import { redirect } from "next/navigation";
import { AskFlow } from "@/components/estimate/AskFlow";
import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

export default async function AskPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  return (
    <AskFlow
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      simple={session.simpleMode}
    />
  );
}
