import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import LocaleCatchAll from "./page";

describe("[locale]/[...rest]", () => {
  it("sends every unmatched path to the localized not-found page", () => {
    expect(() => LocaleCatchAll()).toThrow("NEXT_NOT_FOUND");
  });
});
