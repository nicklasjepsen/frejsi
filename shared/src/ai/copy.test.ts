import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { messageStrings } from "../dosing-vocabulary";
import { assertNoDosing } from "./guard";

const advice =
  /(?<![\p{L}\p{N}_])(bør|skal|should|take|give|giv|næste gang|next time)(?![\p{L}\p{N}_])/iu;
const root = path.resolve(import.meta.dirname, "../../../web/messages");
const selected = (key: string) => /:(ai|say|ask|observation)\.|:settings\.ai\./.test(key);
it("walks both locales and guards all present AI namespaces against advice", () => {
  const keys: string[][] = [];
  for (const locale of ["da", "en"]) {
    const files = Object.fromEntries(
      readdirSync(path.join(root, locale))
        .filter((file) => file.endsWith(".json"))
        .map((file) => [
          file,
          JSON.parse(readFileSync(path.join(root, locale, file), "utf8")) as unknown,
        ]),
    );
    expect(Object.keys(files)).toContain("settings.json");
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const all = messageStrings(files).map(
      ([key, text]) => [key.replace(/\.json:/, ":"), text] as const,
    );
    // A namespace file stores its contents directly, so prefix with the file's namespace.
    const ai = all
      .map(([key, text]) => {
        const [file, suffix] = key.split(":");
        return [`:${file}.${suffix ?? ""}`, text] as const;
      })
      .filter(([key]) => selected(key));
    keys.push(ai.map(([key]) => key).sort());
    expect(ai.filter(([, text]) => advice.test(text))).toEqual([]);
    for (const [key, text] of ai) assertNoDosing(text, key);
  }
  expect(keys[0]).toEqual(keys[1]);
});
it("detects the inherited advice verbs without flagging ordinary descriptive copy", () => {
  for (const text of ["bør", "skal", "should", "take", "give", "giv", "næste gang", "next time"])
    expect(advice.test(text)).toBe(true);
  expect(advice.test("The peak followed the meal.")).toBe(false);
  expect(selected(":settings.ai.notice")).toBe(true);
  expect(selected(":say.title")).toBe(true);
});
