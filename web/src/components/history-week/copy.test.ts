import { expect, it } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import { findDosingVocabulary, messageStrings } from "@frejsi/shared/dosing-vocabulary";

it("has matching Danish and English keys and descriptive copy without advice", () => {
  const da = getMessages("da").historyWeek;
  const en = getMessages("en").historyWeek;
  expect(Object.keys(da).sort()).toEqual(Object.keys(en).sort());
  for (const [locale, messages] of [
    ["da", da],
    ["en", en],
  ] as const) {
    for (const [, value] of messageStrings({ messages })) {
      expect(value).not.toMatch(
        /(?<![\p{L}\p{N}_])(bør|skal|should|take|give|giv|næste gang|next time)(?![\p{L}\p{N}_])/iu,
      );
    }
    expect(findDosingVocabulary(messageStrings({ [`${locale}.historyWeek`]: messages }))).toEqual(
      [],
    );
  }
});
