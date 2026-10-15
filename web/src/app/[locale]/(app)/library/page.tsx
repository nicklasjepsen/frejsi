import { FoodOrigin } from "@frejsi/shared/schemas/food";

import { LibraryScreen } from "@/components/library/LibraryScreen";

import { libraryAccess } from "./access";

/** Mad (phone) / Bibliotek (desktop). */
export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await libraryAccess(params);
  if (!access) return null;
  // Fixed filters also satisfy FoodOrigin, the same format accepted by GET foods.
  const filter = FoodOrigin.safeParse((await searchParams)?.filter);
  const initialFilter = filter.success ? filter.data : "all";
  return (
    <LibraryScreen
      key={initialFilter}
      spaceId={access.spaceId}
      locale={access.locale}
      initialFilter={initialFilter}
    />
  );
}
