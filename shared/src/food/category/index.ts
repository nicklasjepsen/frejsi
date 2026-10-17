import type { FoodCategory } from "../../schemas/food";
import { FRIDA_GROUPS } from "./frida-groups";
import { OFF_TAGS } from "./off-tags";

/** The category of a Frida food group, or none for a group the table does not know. */
export function fridaCategory(group: string): FoodCategory | undefined {
  return FRIDA_GROUPS[group];
}

/**
 * The category of an OFF product from its `categories_tags`: the most specific known tag wins,
 * which is the last known one in OFF's general-to-specific order. Tags are compared folded.
 */
export function offCategory(tags: readonly string[]): FoodCategory | undefined {
  let found: FoodCategory | undefined;
  for (const tag of tags) {
    const category = OFF_TAGS[tag.trim().toLowerCase()];
    if (category) found = category;
  }
  return found;
}
