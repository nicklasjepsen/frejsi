import { expect, it } from "vitest";
import { loadCases, selectCases } from "./cases";
import { checkInsight, checkStrings } from "./score";
it("loads thirty fictional parses, ten normalisations, meal/week statistics and five pending plates", async () => {
  const cases = await loadCases();
  expect(cases.filter((c) => c.kind === "parse").length).toBeGreaterThanOrEqual(30);
  expect(cases.filter((c) => c.kind === "normalise")).toHaveLength(10);
  expect(cases.filter((c) => c.kind === "meal")).toHaveLength(10);
  expect(cases.filter((c) => c.kind === "week")).toHaveLength(5);
  expect(
    cases.filter((c) => c.kind === "photo" && c.photo === "pending").length,
  ).toBeGreaterThanOrEqual(5);
  expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  for (const c of cases) {
    for (const answer of c.recorded) {
      checkStrings(answer);
      if ((c.kind === "meal" || c.kind === "week") && answer.kind === "json")
        checkInsight(answer.json, c.input);
    }
  }
  expect(JSON.stringify(cases.filter((c) => c.kind === "meal" || c.kind === "week"))).not.toMatch(
    /"readings"|"ts"/,
  );
});
it("defaults PR to text and ten ready plates, release includes weekly and all plates", async () => {
  const cases = await loadCases();
  const photo = cases.find((c) => c.kind === "photo");
  if (!photo) throw Error("missing photo");
  const expanded = [
    ...cases,
    ...Array.from({ length: 25 }, (_, i) => ({ ...photo, id: `ready-${i}`, photo: `${i}.jpg` })),
  ];
  const pr = selectCases(expanded, "pr");
  expect(pr.some((c) => c.kind === "week")).toBe(false);
  expect(pr.filter((c) => c.kind === "photo" && c.photo !== "pending")).toHaveLength(10);
  expect(selectCases(expanded, "release")).toHaveLength(expanded.length);
});
