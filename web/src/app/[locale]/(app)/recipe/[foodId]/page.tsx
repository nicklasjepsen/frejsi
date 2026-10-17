import { RecipeScreen } from "@/components/recipes/RecipeScreen";

import { libraryAccess } from "../../library/access";

/** A saved dish from a recipe, opened to edit a line or the yield; "Gem" recalculates it. */
export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ locale: string; foodId: string }>;
}) {
  const access = await libraryAccess(params);
  if (!access) return null;
  return (
    <RecipeScreen spaceId={access.spaceId} locale={access.locale} foodId={(await params).foodId} />
  );
}
