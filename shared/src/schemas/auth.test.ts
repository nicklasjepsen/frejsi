import { describe, expect, it } from "vitest";

import { InviteView, Role, SessionContext } from "./auth";

describe("Role", () => {
  it("is owner, carer or viewer", () => {
    expect(Role.options).toEqual(["owner", "carer", "viewer"]);
    expect(Role.safeParse("admin").success).toBe(false);
  });
});

describe("SessionContext", () => {
  const valid = {
    userId: "u1",
    name: "Example Person",
    simpleMode: false,
    accent: "olive",
    locale: "da",
    memberships: [{ spaceId: "s1", role: "carer" }],
  };

  it("accepts the shape the layouts and routes read", () => {
    expect(SessionContext.parse(valid)).toEqual(valid);
  });

  it("rejects a membership with an unknown role", () => {
    expect(
      SessionContext.safeParse({ ...valid, memberships: [{ spaceId: "s1", role: "god" }] }).success,
    ).toBe(false);
  });
});

describe("InviteView", () => {
  const valid = {
    name: "Example Person",
    spaceName: "Example space",
    role: "viewer",
    inviterName: "Example Owner",
    daysLeft: 6,
    forExistingUser: false,
  };

  it("accepts what the invite landing page gets", () => {
    expect(InviteView.parse(valid)).toEqual(valid);
  });

  it("rejects negative days left", () => {
    expect(InviteView.safeParse({ ...valid, daysLeft: -1 }).success).toBe(false);
  });
});
