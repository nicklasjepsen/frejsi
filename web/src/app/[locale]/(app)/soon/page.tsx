import { cookies } from "next/headers";

import { SPACE_COOKIE } from "@/components/shell/space-cookie";
import { loadShellData } from "@/components/shell/load-shell";
import { SoonPage } from "@/components/shell/SoonPage";
import { getSession } from "@/lib/auth/session";
import { resolveLocale } from "@/lib/i18n/routing";

/** The placeholder without a named feature. */
export default async function Soon({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const session = await getSession();
  if (!session) return null;
  const shell = await loadShellData(session, (await cookies()).get(SPACE_COOKIE)?.value);
  return <SoonPage locale={locale} feature={null} role={shell?.space.role ?? "carer"} />;
}
