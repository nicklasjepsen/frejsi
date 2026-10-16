import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { NoSpace } from "@/components/shell/NoSpace";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { ThemeSync } from "@/components/shell/ThemeSync";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * Every signed-in screen: the session is checked here, not in the middleware (plan §6). A null
 * session renders nothing of the page and sends the browser to welcome: the middleware only
 * checks that the cookie exists, so a cookie whose row has expired or been deleted still arrives
 * here. A route answers 403 on its own through `requireRole`.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  if (!session) redirect(localeHref(locale, "/welcome"));

  // The stored theme reaches the device's cookie here when it did not at sign-in.
  const theme = <ThemeSync theme={session.theme} />;

  const shell = await getShell();
  if (!shell) {
    return (
      <>
        {theme}
        <NoSpace accent={session.accent} />
      </>
    );
  }

  return (
    <>
      {theme}
      <AppShell
        locale={locale}
        user={{ name: session.name, accent: session.accent, simpleMode: session.simpleMode }}
        space={shell.space}
        spaces={shell.spaces}
      >
        {children}
      </AppShell>
    </>
  );
}
