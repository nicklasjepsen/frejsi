import { FoodEditScreen } from "@/components/library/FoodEditScreen";

import { libraryAccess } from "../access";

/** One food on the phone (no artboard; built from the desktop edit panel). */
export default async function FoodPage({
  params,
}: {
  params: Promise<{ locale: string; foodId: string }>;
}) {
  const access = await libraryAccess(params);
  if (!access) return null;
  const { foodId } = await params;
  return <FoodEditScreen spaceId={access.spaceId} locale={access.locale} foodId={foodId} />;
}
