import da from "../../../messages/da.json";
import en from "../../../messages/en.json";

import type { AppLocale } from "./routing";

export type Messages = typeof da;

const MESSAGES: Record<AppLocale, Messages> = { da, en };

/** The message tree for a locale; both files carry the same keys (messages.test.ts). */
export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale];
}
