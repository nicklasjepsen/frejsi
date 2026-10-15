import { GlucoseSourceType } from "@frejsi/shared";
import { notFound, redirect } from "next/navigation";

import { ConnectSourceForm } from "@/components/settings/ConnectSourceForm";
import { loadSettingsData } from "@/components/settings/load-settings";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * "Skift login": the connect form, owners only. Anyone else is sent back to Settings; the route
 * behind the form refuses them too (plan task 9).
 */
export default async function ConnectSourcePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shell.space.role !== "owner") redirect(localeHref(locale, "/settings"));
  const data = await loadSettingsData(session, shell.space);
  // The configured type, else the first one there is; with none defined there is nothing to connect.
  const sourceType = data.source?.type ?? GlucoseSourceType.options.at(0);
  if (!sourceType) notFound();
  return (
    <ConnectSourceForm
      locale={locale}
      spaceId={shell.space.id}
      sourceType={sourceType}
      {...(data.source?.region ? { region: data.source.region } : {})}
    />
  );
}
