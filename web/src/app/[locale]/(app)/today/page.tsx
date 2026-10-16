import { getShell } from "@/components/shell/shell-session";
import { resolveLocale } from "@/lib/i18n/routing";

import { TodayScreen } from "./TodayScreen";

/**
 * I dag: the day's meals and carbs for any member of the space, a viewer first of all. The
 * `(app)` layout has checked the session and `getShell` shares its load; the API checks the role.
 */
export default async function TodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const shell = await getShell();
  if (!shell) return null;
  return (
    <TodayScreen
      key={shell.space.id}
      spaceId={shell.space.id}
      locale={locale}
      role={shell.space.role}
    />
  );
}
