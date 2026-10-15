import da from "../../../messages/da";
import en from "../../../messages/en";

import type { AppLocale } from "./routing";

export type Messages = typeof da;

const MESSAGES: Record<AppLocale, Messages> = { da, en };

/**
 * The message tree for a locale, assembled from web/messages/<locale>/<namespace>.json; both
 * locales carry the same namespaces and keys (messages.test.ts).
 */
export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale];
}
