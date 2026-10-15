import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale, type AppLocale } from "@/lib/i18n/routing";

/**
 * Who may open the library. The `(app)` layout has checked the session and `getShell` shares its
 * load; null means the layout is redirecting. A viewer is sent to their day (the foods routes
 * answer them 403 anyway); a simpleMode session is sent to Nu: the library is not in the simple
 * shell, and simpleMode shows verified foods only (plan §11 decision 11).
 */
export async function libraryAccess(
  params: Promise<{ locale: string }>,
): Promise<{ locale: AppLocale; spaceId: string } | null> {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  if (shell.space.role === "viewer") redirect(localeHref(locale, homePath("viewer")));
  if (session.simpleMode) redirect(localeHref(locale, "/now"));
  return { locale, spaceId: shell.space.id };
}
