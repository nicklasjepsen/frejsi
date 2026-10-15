import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { NowScreen } from "./NowScreen";

/**
 * Nu. The `(app)` layout has checked the session and `getShell` shares its load. A viewer is sent
 * to their own landing: the shell never links here for them, and the API would refuse the
 * readings anyway (plan §5); this is only so the URL does not show an empty page.
 */
export default async function NowPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  return (
    <NowScreen
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      simpleMode={session.simpleMode}
      timeZone={shell.space.timezone}
    />
  );
}
