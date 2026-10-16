import { redirect } from "next/navigation";

import { ImportScreen } from "@/components/settings/ImportScreen";
import { shellVariant } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

/**
 * Importér (#154): the file picker for an export, owners only. Anyone else is sent back to
 * Settings; the route behind the form refuses them too. A simpleMode member goes to Nu first,
 * as from Settings itself.
 */
export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shellVariant(shell.space.role, session.simpleMode) === "simple")
    redirect(localeHref(locale, "/now"));
  if (shell.space.role !== "owner") redirect(localeHref(locale, "/settings"));
  return <ImportScreen locale={locale} spaceId={shell.space.id} timezone={shell.space.timezone} />;
}
