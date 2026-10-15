import { describe, expect, it } from "vitest";

import { ApiError, ApiErrorCode, HttpError, toApiError } from "./api";

describe("ApiError", () => {
  it("carries a stable code and a message, never a stack", () => {
    const valid = { error: { code: "not-found", message: "No such space" } };
    expect(ApiError.parse(valid)).toEqual(valid);
    expect(ApiErrorCode.options).toEqual([
      "forbidden",
      "not-found",
      "invite-expired",
      "invite-used",
      "invite-revoked",
      "last-owner",
      "source-bad-credentials",
      "source-unreachable",
      "validation",
      "internal",
      "simple-mode",
      "photo-too-large",
      "photo-type",
      "photo-unavailable",
      "barcode-invalid",
      "lookup-unavailable",
    ]);
  });

  it("rejects a code that is not on the list", () => {
    expect(ApiError.safeParse({ error: { code: "oops", message: "x" } }).success).toBe(false);
  });
});

describe("HttpError", () => {
  it("maps to an ApiError body with its status", () => {
    const err = new HttpError(404, "not-found");
    expect(err.status).toBe(404);
    expect(toApiError(err)).toEqual({
      status: 404,
      body: { error: { code: "not-found", message: "not-found" } },
    });
  });

  it("turns anything else into a 500 `internal` whose body carries nothing from the original error", () => {
    const { status, body } = toApiError(new Error("Example Person's password is hunter2"));
    expect(status).toBe(500);
    // Its own code, so the client shows "our side" copy rather than the validation copy.
    expect(body.error.code).toBe("internal");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });
});
