import { LibraryScreen } from "@/components/library/LibraryScreen";

import { libraryAccess } from "./access";

/** Mad (phone) / Bibliotek (desktop). */
export default async function LibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const access = await libraryAccess(params);
  if (!access) return null;
  return <LibraryScreen spaceId={access.spaceId} locale={access.locale} />;
}
