import { notFound } from "next/navigation";

/**
 * Any path under a locale that no route matches lands here, so the localized `not-found.tsx`
 * next to the layout renders instead of Next's built-in English 404. Real routes win over this
 * catch-all, so the pages other lanes add are never shadowed.
 */
export default function LocaleCatchAll(): never {
  notFound();
}
