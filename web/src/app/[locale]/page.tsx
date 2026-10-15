import { redirect } from "next/navigation";

import { homePath } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * `/da` and `/en` are the app's entry (the installed app's `start_url` lands here through the
 * middleware), not a page: they go to the role's home in the chosen space, or to welcome without
 * a session. The home is in the user's own language (`User.locale`, settable in Settings), not
 * the URL's: the middleware picks the URL's locale from a cookie or the browser, which a new
 * device cannot know. A URL with a locale, such as `/en/now`, keeps it.
 */
export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const urlLocale = resolveLocale((await params).locale);
  const session = await getShellSession();
  if (!session) redirect(localeHref(urlLocale, "/welcome"));
  const shell = await getShell();
  const home = shell ? homePath(shell.space.role) : "/now";
  redirect(localeHref(resolveLocale(session.locale), home));
}
