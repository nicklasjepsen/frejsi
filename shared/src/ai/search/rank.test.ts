import { expect, it } from "vitest";
import { mergeSemantic } from "./rank";
it("keeps keyword order, appends near unique semantic hits only", () => {
  expect(
    mergeSemantic(
      [{ id: "b" }, { id: "a" }],
      [
        { food: { id: "a" }, distance: 0 },
        { food: { id: "c" }, distance: 0.35 },
        { food: { id: "d" }, distance: 0.36 },
        { food: { id: "e" }, distance: NaN },
      ],
    ),
  ).toEqual([{ id: "b" }, { id: "a" }, { id: "c" }]);
});
