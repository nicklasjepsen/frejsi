import { HttpError } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { parseArgs, requireOwner, type CliUser } from "./cli";

const user = (role: "owner" | "carer" | "viewer", spaceId = "s1"): CliUser => ({
  id: "u1",
  name: "Test",
  simpleMode: false,
  accent: "olive",
  locale: "da",
  memberships: [{ spaceId, role }],
});

describe("parseArgs", () => {
  it("reads the file, space and user, with meals on", () => {
    expect(parseArgs(["--", "f.csv", "--space", "s1", "--user", "u1"])).toEqual({
      file: "f.csv",
      spaceId: "s1",
      userId: "u1",
      createMeals: true,
    });
  });
  it("--no-meals turns meals off, in any position", () => {
    expect(parseArgs(["--no-meals", "--user", "u1", "f.csv", "--space", "s1"]).createMeals).toBe(
      false,
    );
  });
  it.each([
    [[]],
    [["f.csv", "--space", "s1"]],
    [["--space", "s1", "--user", "u1"]],
    [["f.csv", "g.csv", "--space", "s1", "--user", "u1"]],
    [["f.csv", "--space", "--user", "u1"]],
    [["f.csv", "--space", "s1", "--user", "u1", "--bogus"]],
  ])("refuses %j as validation", (argv) => {
    expect(() => parseArgs(argv)).toThrow(expect.objectContaining({ code: "validation" }));
  });
});

describe("requireOwner", () => {
  it("builds the session of an owner of the space", () => {
    expect(requireOwner(user("owner"), "s1")).toMatchObject({
      userId: "u1",
      memberships: [{ spaceId: "s1", role: "owner" }],
    });
  });
  it.each(["carer", "viewer"] as const)("refuses a %s", (role) => {
    expect(() => requireOwner(user(role), "s1")).toThrow(HttpError);
    expect(() => requireOwner(user(role), "s1")).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
  it("refuses an owner of another space", () => {
    expect(() => requireOwner(user("owner", "s2"), "s1")).toThrow(
      expect.objectContaining({ code: "forbidden" }),
    );
  });
  it("answers not-found for an unknown user", () => {
    expect(() => requireOwner(null, "s1")).toThrow(expect.objectContaining({ code: "not-found" }));
  });
});
