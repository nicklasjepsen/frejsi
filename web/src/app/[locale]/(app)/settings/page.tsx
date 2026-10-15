import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { loadSettingsData } from "@/components/settings/load-settings";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { resolveLocale } from "@/lib/i18n/routing";

/**
 * Indstillinger / Mere (plan task 9). The `(app)` layout has already checked the session and
 * renders the no-space page itself, so nothing is drawn here without both. The data is loaded
 * per role on the server: a viewer's page never carries the space section.
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  const data = await loadSettingsData(session, shell.space);
  return <SettingsScreen locale={locale} data={data} now={new Date().toISOString()} />;
}
