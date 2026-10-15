import { loadPeople } from "@/components/people/load-people";
import { PeopleScreen } from "@/components/people/PeopleScreen";
import { getShell, getShellSession } from "@/components/shell/shell-session";
import { assertRole } from "@/lib/auth/session";
import { resolveLocale } from "@/lib/i18n/routing";

/**
 * Personer for the device's chosen space. The `(app)` layout has checked the session and shares
 * its load through `getShellSession`/`getShell`; a null here means the layout is redirecting and
 * nothing of the page is rendered. Any member may read the list, a viewer included: there is no
 * glucose in it (spec §2). The owner-only writes are checked again by their routes.
 */
export default async function PeoplePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const [session, shell] = await Promise.all([getShellSession(), getShell()]);
  if (!session || !shell) return null;
  const { role } = assertRole(session, shell.space.id);
  const view = await loadPeople(shell.space.id);
  return (
    <PeopleScreen
      locale={locale}
      spaceId={shell.space.id}
      spaceName={shell.space.name}
      timezone={shell.space.timezone}
      currentUserId={session.userId}
      role={role}
      initial={view}
    />
  );
}
