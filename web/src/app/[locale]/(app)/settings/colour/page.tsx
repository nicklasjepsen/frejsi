import { redirect } from "next/navigation";

import { ColourScreen } from "@/components/settings/ColourScreen";
import { loadSettingsData } from "@/components/settings/load-settings";
import { shellVariant } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * Farve (Farve-Indstilling): the per-person accent colour. Reached from Settings, so it is gated
 * like Settings: the simple shell has none, and a simpleMode member goes to Nu.
 */
export default async function ColourPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shellVariant(shell.space.role, session.simpleMode) === "simple")
    redirect(localeHref(locale, "/now"));
  const data = await loadSettingsData(session, shell.space);
  return <ColourScreen locale={locale} data={data} />;
}
