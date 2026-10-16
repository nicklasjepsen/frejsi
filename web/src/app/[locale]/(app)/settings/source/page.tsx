import { redirect } from "next/navigation";

import { SourcePicker } from "@/components/settings/SourcePicker";
import { loadSettingsData } from "@/components/settings/load-settings";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * The phone page behind the "Glukosekilde" row: the three sources as cards, owners only. Anyone
 * else is sent back to Settings; the `source` route refuses them too.
 */
export default async function SourcePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shell.space.role !== "owner") redirect(localeHref(locale, "/settings"));
  const data = await loadSettingsData(session, shell.space);
  if (!data.source) redirect(localeHref(locale, "/settings"));
  return (
    <SourcePicker
      locale={locale}
      spaceId={data.spaceId}
      source={data.source}
      timezone={data.timezone}
      now={new Date().toISOString()}
    />
  );
}
