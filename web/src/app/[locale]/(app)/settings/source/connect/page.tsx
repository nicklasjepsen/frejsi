import { GlucoseSourceType } from "@frejsi/shared";
import { redirect } from "next/navigation";

import { ConnectSourceForm } from "@/components/settings/ConnectSourceForm";
import { loadSettingsData } from "@/components/settings/load-settings";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * "Skift login" / "Forbind": the connect form for the source in `?type=`, owners only. Anyone else
 * is sent back to Settings, and so is a type with no login (`manual`) or one that does not exist;
 * the route behind the form refuses non-owners too.
 */
export default async function ConnectSourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shell.space.role !== "owner") redirect(localeHref(locale, "/settings"));
  const requested = GlucoseSourceType.safeParse((await searchParams).type);
  if (!requested.success || requested.data === "manual")
    redirect(localeHref(locale, "/settings/source"));
  const data = await loadSettingsData(session, shell.space);
  const region = data.source?.type === requested.data ? data.source.region : null;
  return (
    <ConnectSourceForm
      locale={locale}
      spaceId={shell.space.id}
      sourceType={requested.data}
      {...(region ? { region } : {})}
    />
  );
}
