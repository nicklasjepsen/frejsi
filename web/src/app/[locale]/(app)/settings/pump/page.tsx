import { redirect } from "next/navigation";

import { loadSettingsData } from "@/components/settings/load-settings";
import { shellVariant } from "@/components/shell/nav";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { PumpScreen } from "./PumpScreen";

/**
 * The phone page behind the "Pumpehistorik" row (v0.7.0 plan task 3), as `settings/source` is for
 * the glucose source: the card with the form for an owner, the status alone for a carer. A
 * simpleMode member goes to Nu and a viewer back to Settings before anything is read; the
 * initial state is `load-settings.ts`'s, which gives neither of them a pump record, and the
 * `pump-source` route refuses them too.
 */
export default async function PumpPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getShellSession();
  const shell = await getShell();
  if (!session || !shell) return null;
  if (shellVariant(shell.space.role, session.simpleMode) === "simple")
    redirect(localeHref(locale, "/now"));
  if (shell.space.role === "viewer") redirect(localeHref(locale, "/settings"));
  const data = await loadSettingsData(session, shell.space);
  if (!data.pump) redirect(localeHref(locale, "/settings"));
  return (
    <PumpScreen
      locale={locale}
      spaceId={data.spaceId}
      pump={data.pump}
      timezone={data.timezone}
      now={new Date().toISOString()}
      owner={data.role === "owner"}
    />
  );
}
