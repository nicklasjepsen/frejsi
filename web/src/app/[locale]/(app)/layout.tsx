import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/AppShell";
import { NoSpace } from "@/components/shell/NoSpace";
import { SPACE_COOKIE } from "@/components/shell/space-cookie";
import { loadShellData } from "@/components/shell/load-shell";
import { getSession } from "@/lib/auth/session";
import { resolveLocale } from "@/lib/i18n/routing";

/**
 * Every signed-in screen: the session is checked here, not in the middleware (plan §6). A null
 * session renders nothing; the middleware has already sent the browser to welcome, and a route
 * answers 403 on its own through `requireRole`.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const session = await getSession();
  if (!session) return null;

  const locale = resolveLocale((await params).locale);
  const shell = await loadShellData(session, (await cookies()).get(SPACE_COOKIE)?.value);
  if (!shell) return <NoSpace accent={session.accent} />;

  return (
    <AppShell
      locale={locale}
      user={{ name: session.name, accent: session.accent, simpleMode: session.simpleMode }}
      space={shell.space}
      spaces={shell.spaces}
    >
      {children}
    </AppShell>
  );
}
