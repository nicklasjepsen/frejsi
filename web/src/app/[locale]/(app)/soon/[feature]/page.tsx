import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { SPACE_COOKIE } from "@/components/shell/space-cookie";
import { loadShellData } from "@/components/shell/load-shell";
import { SoonPage } from "@/components/shell/SoonPage";
import { isSoonFeature } from "@/components/shell/soon-features";
import { getSession } from "@/lib/auth/session";
import { resolveLocale } from "@/lib/i18n/routing";

/** "Kommer i en senere version" for one unbuilt destination; the viewer's I dag for `today`. */
export default async function SoonFeature({
  params,
}: {
  params: Promise<{ locale: string; feature: string }>;
}) {
  const { locale: rawLocale, feature } = await params;
  if (!isSoonFeature(feature)) notFound();
  const locale = resolveLocale(rawLocale);
  const session = await getSession();
  if (!session) return null;
  const shell = await loadShellData(session, (await cookies()).get(SPACE_COOKIE)?.value);
  return <SoonPage locale={locale} feature={feature} role={shell?.space.role ?? "carer"} />;
}
