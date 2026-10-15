import { redirect } from "next/navigation";

import { ImportScreen } from "@/components/settings/ImportScreen";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * Importér (#154): the file picker for an export, owners only. Anyone else is sent back to
 * Settings; the route behind the form refuses them too.
 */
export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shell.space.role !== "owner") redirect(localeHref(locale, "/settings"));
  return <ImportScreen locale={locale} spaceId={shell.space.id} timezone={shell.space.timezone} />;
}
