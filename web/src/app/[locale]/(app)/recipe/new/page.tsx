import { RecipeScreen } from "@/components/recipes/RecipeScreen";

import { libraryAccess } from "../../library/access";

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;

/**
 * Ny ret fra opskrift (plan §6). The same access as the library: a viewer goes to their day, a
 * simpleMode session to Nu (it shows verified foods only; a dish from a recipe is unverified).
 * `?meal=` opens a logged meal's items, `?share=` the phone's share.
 */
export default async function NewRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await libraryAccess(params);
  if (!access) return null;
  const query = (await searchParams) ?? {};
  return (
    <RecipeScreen
      spaceId={access.spaceId}
      locale={access.locale}
      mealId={one(query.meal)}
      shareId={one(query.share)}
    />
  );
}
