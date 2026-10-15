import { ColourScreen } from "@/components/settings/ColourScreen";
import { loadSettingsData } from "@/components/settings/load-settings";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { resolveLocale } from "@/lib/i18n/routing";

/** Farve (Farve-Indstilling): the per-person accent colour. Reached from Settings. */
export default async function ColourPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  const data = await loadSettingsData(session, shell.space);
  return <ColourScreen locale={locale} data={data} />;
}
