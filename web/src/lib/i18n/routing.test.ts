import { Locale } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  localeHref,
  negotiateLocale,
  resolveLocale,
  stripLocale,
} from "./routing";

describe("routing", () => {
  it("knows exactly the locales of the shared contract, da first and default", () => {
    // Duplicated on purpose: the middleware runs on the edge and must not import @frejsi/shared.
    expect([...LOCALES]).toEqual([...Locale.options]);
    expect(DEFAULT_LOCALE).toBe("da");
  });

  it("isLocale and resolveLocale accept only da and en", () => {
    expect(isLocale("da")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("sv")).toBe(false);
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("sv")).toBe("da");
    expect(resolveLocale(null)).toBe("da");
    expect(resolveLocale(undefined)).toBe("da");
  });

  it("negotiateLocale reads Accept-Language by q-value and language prefix", () => {
    expect(negotiateLocale("en-GB,en;q=0.9,da;q=0.8")).toBe("en");
    expect(negotiateLocale("da-DK,da;q=0.9,en;q=0.8")).toBe("da");
    expect(negotiateLocale("sv-SE,sv;q=0.9,en;q=0.5")).toBe("en");
    expect(negotiateLocale("de;q=0.5, en;q=0.4, da")).toBe("da");
    expect(negotiateLocale("sv")).toBeNull();
    expect(negotiateLocale("")).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
    expect(negotiateLocale("en;q=0")).toBeNull();
  });

  it("localeHref prefixes a path and stripLocale removes it", () => {
    expect(localeHref("da", "/now")).toBe("/da/now");
    expect(localeHref("en", "now")).toBe("/en/now");
    expect(localeHref("en", "/")).toBe("/en");
    expect(stripLocale("/da/now")).toEqual({ locale: "da", path: "/now" });
    expect(stripLocale("/en")).toEqual({ locale: "en", path: "/" });
    expect(stripLocale("/sv/now")).toEqual({ locale: null, path: "/sv/now" });
  });
});
