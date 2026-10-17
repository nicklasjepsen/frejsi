import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractText, parseIngredientLine, parseYield, readJsonLd } from "./jsonld";

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../../../fixtures/recipes", name), "utf8");

describe("readJsonLd (a schema.org/Recipe page needs no model, decision 10)", () => {
  it("reads the lasagne fixture's lines into name, amount and unit, and its yield in portions", () => {
    const parse = readJsonLd(fixture("lasagne.jsonld.html"));
    expect(parse).toEqual({
      title: "Eksempellasagne",
      yieldPortions: 6,
      ingredients: [
        { name: "hakket oksekød", amount: 500, unit: "g" },
        { name: "flåede tomater", amount: 2, unit: "dåse" },
        { name: "løg", amount: 1 },
        { name: "lasagneplader", amount: 250, unit: "g" },
        { name: "mælk", amount: 5, unit: "dl" },
        { name: "salt og peber" },
      ],
    });
  });
  it("finds a bare Recipe object, a list of objects and a @graph alike, and ignores other types", () => {
    const page = (json: unknown) =>
      `<html><script type="application/ld+json">${JSON.stringify(json)}</script></html>`;
    const recipe = { "@type": "Recipe", name: "Fictional soup", recipeIngredient: ["1 l vand"] };
    for (const json of [recipe, [{ "@type": "Article" }, recipe], { "@graph": [recipe] }])
      expect(readJsonLd(page(json))?.title).toBe("Fictional soup");
    expect(readJsonLd(page({ "@type": "Article", name: "Not a recipe" }))).toBeNull();
    expect(readJsonLd(page({ "@type": ["Thing", "Recipe"], name: "Typed twice" }))?.title).toBe(
      "Typed twice",
    );
    expect(readJsonLd("<html><p>no structured data</p></html>")).toBeNull();
    expect(readJsonLd('<script type="application/ld+json">{not json</script>')).toBeNull();
  });
  it("reads recipeYield as a number, a string with a number, or a list, and caps the lines at 40", () => {
    const page = (extra: Record<string, unknown>) =>
      `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Y", recipeIngredient: ["1 l vand"], ...extra })}</script>`;
    expect(readJsonLd(page({ recipeYield: 4 }))?.yieldPortions).toBe(4);
    expect(readJsonLd(page({ recipeYield: "6 portioner" }))?.yieldPortions).toBe(6);
    expect(readJsonLd(page({ recipeYield: ["8", "8 servings"] }))?.yieldPortions).toBe(8);
    expect(readJsonLd(page({ recipeYield: "ca. 1 kg" }))?.yieldGrams).toBe(1000);
    expect(readJsonLd(page({ recipeYield: "a potful" }))?.yieldPortions).toBeUndefined();
    const many = readJsonLd(
      page({ recipeIngredient: Array.from({ length: 50 }, (_, i) => `${i + 1} g mel`) }),
    );
    expect(many?.ingredients).toHaveLength(40);
  });
  it("names an unnamed Recipe after the page title, then the caller's fallback, then Recipe", () => {
    const block = (name: string) =>
      `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name, recipeIngredient: ["1 l vand"] })}</script>`;
    expect(
      readJsonLd(`<html><head><title> Fiktiv side &amp; mad </title></head>${block("")}</html>`)
        ?.title,
    ).toBe("Fiktiv side & mad");
    expect(readJsonLd(block(""), { fallbackTitle: "Opskrift" })?.title).toBe("Opskrift");
    expect(readJsonLd(block(""))?.title).toBe("Recipe");
    expect(readJsonLd(`<title>Ignored</title>${block("Named")}`)?.title).toBe("Named");
  });
  it("finds the block by scanning, whatever the attribute order or case, and stays linear on a hostile page", () => {
    const recipe = JSON.stringify({
      "@type": "Recipe",
      name: "Scanned",
      recipeIngredient: ["1 l vand"],
    });
    expect(
      readJsonLd(`<SCRIPT id="x" TYPE='application/ld+json' async>${recipe}</SCRIPT>`)?.title,
    ).toBe("Scanned");
    expect(readJsonLd(`<script type="text/javascript">${recipe}</script>`)).toBeNull();
    const hostile = "<script".repeat(50_000) + "<svg>".repeat(50_000);
    const started = performance.now();
    expect(readJsonLd(hostile)).toBeNull();
    expect(extractText(hostile)).toBe("");
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("parseIngredientLine (the amount-unit-name grammar)", () => {
  it.each([
    ["500 g hakket oksekød", { name: "hakket oksekød", amount: 500, unit: "g" }],
    ["2 dåser flåede tomater", { name: "flåede tomater", amount: 2, unit: "dåse" }],
    ["1,5 dl fløde", { name: "fløde", amount: 1.5, unit: "dl" }],
    ["2.5 kg kartofler", { name: "kartofler", amount: 2.5, unit: "kg" }],
    ["½ l mælk", { name: "mælk", amount: 0.5, unit: "l" }],
    ["1 1/2 tsk salt", { name: "salt", amount: 1.5, unit: "tsk" }],
    ["3 spsk olie", { name: "olie", amount: 3, unit: "spsk" }],
    ["2 stk æg", { name: "æg", amount: 2, unit: "stk" }],
    ["4 æg", { name: "æg", amount: 4 }],
    ["2 tablespoons sugar", { name: "sugar", amount: 2, unit: "tbsp" }],
    ["1 cup flour", { name: "flour", amount: 1, unit: "cup" }],
    ["salt og peber", { name: "salt og peber" }],
    ["  Pasta (ca. 200 g)  ", { name: "Pasta (ca. 200 g)" }],
    ["2-3 fed hvidløg", { name: "hvidløg", amount: 2, unit: "fed" }],
  ])("%s", (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
  it("drops an empty line and bounds the name", () => {
    expect(parseIngredientLine("   ")).toBeNull();
    expect(parseIngredientLine(`1 g ${"x".repeat(200)}`)?.name).toHaveLength(120);
  });
  it("reads a yield line", () => {
    expect(parseYield("6 portioner")).toEqual({ yieldPortions: 6 });
    expect(parseYield("Til 4 personer")).toEqual({ yieldPortions: 4 });
    expect(parseYield("12 stk")).toEqual({ yieldPortions: 12 });
    expect(parseYield("1,2 kg")).toEqual({ yieldGrams: 1200 });
    expect(parseYield("800 g")).toEqual({ yieldGrams: 800 });
    expect(parseYield("")).toEqual({});
  });
});

describe("extractText (a page without JSON-LD goes to the model as stripped text)", () => {
  it("strips tags, scripts and styles, collapses whitespace and caps at 12 000 characters", () => {
    const text = extractText(fixture("lasagne.jsonld.html"));
    expect(text).toContain("Eksempellasagne");
    expect(text).toContain("En fiktiv lasagne til seks personer.");
    expect(text).not.toContain("<");
    expect(text).not.toContain("font-family");
    expect(text).not.toContain("@type");
    expect(text).not.toMatch(/\s{2}/);
    const long = extractText(`<p>${"a ".repeat(20_000)}</p>`);
    expect(long.length).toBeLessThanOrEqual(12_000);
    expect(long.length).toBeGreaterThan(11_990);
    expect(extractText("<p>a &amp; b &oslash; &#230; &#xe5;</p>")).toBe("a & b ø æ å");
  });
});
