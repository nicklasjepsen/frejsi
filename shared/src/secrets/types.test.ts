import { describe, expect, it } from "vitest";

import { formatSecretRef, glucoseSecretName, parseSecretRef } from "./types";

describe("secret references (#78)", () => {
  it("splits <name>/<version> and reads a plain name as the latest", () => {
    expect(parseSecretRef("glucose-s1/0123abcd")).toEqual({
      name: "glucose-s1",
      version: "0123abcd",
    });
    expect(parseSecretRef("glucose-s1")).toEqual({ name: "glucose-s1" });
    expect(formatSecretRef("glucose-s1", "7")).toBe("glucose-s1/7");
    expect(parseSecretRef(formatSecretRef(glucoseSecretName("s1"), "a1"))).toEqual({
      name: "glucose-s1",
      version: "a1",
    });
  });

  it("refuses anything but [a-z0-9-] names and [a-z0-9] versions, naming neither", () => {
    for (const ref of ["", "../x", "A", "a.b", "a b", "a_b", "x\0", "/v"]) {
      expect(() => parseSecretRef(ref), JSON.stringify(ref)).toThrow(/^secret name is invalid$/);
    }
    for (const ref of ["a/", "a/V", "a/v.1", "a/../x", "a/-", "a//v", "a/v/w"]) {
      expect(() => parseSecretRef(ref), JSON.stringify(ref)).toThrow(/^secret version is invalid$/);
    }
    expect(() => formatSecretRef("a/b", "1")).toThrow(/^secret name is invalid$/);
    expect(() => formatSecretRef("a", "")).toThrow(/^secret version is invalid$/);
  });
});
