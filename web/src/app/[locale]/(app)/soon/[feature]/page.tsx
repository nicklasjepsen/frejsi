import { notFound } from "next/navigation";

import { SoonPage } from "@/components/shell/SoonPage";
import { getShell } from "@/components/shell/shell-session";
import { isSoonFeature } from "@/components/shell/soon-features";
import { resolveLocale } from "@/lib/i18n/routing";

/**
 * "Kommer i en senere version" for one unbuilt destination; the viewer's I dag for `today`. The
 * `(app)` layout has already checked the session; `getShell` shares its load.
 */
export default async function SoonFeature({
  params,
}: {
  params: Promise<{ locale: string; feature: string }>;
}) {
  const { locale: rawLocale, feature } = await params;
  if (!isSoonFeature(feature)) notFound();
  const locale = resolveLocale(rawLocale);
  const shell = await getShell();
  return <SoonPage locale={locale} feature={feature} role={shell?.space.role ?? "carer"} />;
}
