import { SoonPage } from "@/components/shell/SoonPage";
import { getShell } from "@/components/shell/shell-session";
import { resolveLocale } from "@/lib/i18n/routing";

/** The placeholder without a named feature. The `(app)` layout has already checked the session. */
export default async function Soon({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const shell = await getShell();
  return <SoonPage locale={locale} feature={null} role={shell?.space.role ?? "carer"} />;
}
