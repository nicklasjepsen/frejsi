import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { SPACE_COOKIE } from "@/components/shell/space-cookie";
import { loadShellData } from "@/components/shell/load-shell";
import { homePath } from "@/components/shell/nav";
import { getSession } from "@/lib/auth/session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/** `/da` lands on the role's home in the chosen space, or on welcome without a session. */
export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getSession();
  if (!session) redirect(localeHref(locale, "/welcome"));
  const shell = await loadShellData(session, (await cookies()).get(SPACE_COOKIE)?.value);
  redirect(localeHref(locale, shell ? homePath(shell.space.role) : "/now"));
}
