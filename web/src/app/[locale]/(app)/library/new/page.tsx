import { FoodEditScreen } from "@/components/library/FoodEditScreen";

import { libraryAccess } from "../access";

/** Ny fødevare on the phone (no artboard; built from the desktop edit panel). */
export default async function NewFoodPage({ params }: { params: Promise<{ locale: string }> }) {
  const access = await libraryAccess(params);
  if (!access) return null;
  return <FoodEditScreen spaceId={access.spaceId} locale={access.locale} />;
}
