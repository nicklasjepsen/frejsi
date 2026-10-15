// @vitest-environment node
import { describe, expect, it } from "vitest";

import { INVITE_TTL_MS } from "@/lib/auth/invites";

import { INVITE_VALID_DAYS } from "./contract";

describe("INVITE_VALID_DAYS", () => {
  it("is the auth core's INVITE_TTL_MS in days, so the validity line never lies about the link", () => {
    expect(INVITE_VALID_DAYS * 24 * 60 * 60 * 1000).toBe(INVITE_TTL_MS);
  });
});
