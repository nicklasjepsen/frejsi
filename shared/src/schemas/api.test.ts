import { readFileSync } from "node:fs";
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
      "import-unrecognised",
      "import-empty",
      "ai-disabled",
      "ai-not-configured",
      "ai-cap-reached",
      "ai-unavailable",
      "ai-rejected",
      "push-not-configured",
      "source-not-manual",
      "reading-exists",
      "reading-out-of-window",
      "source-url-invalid",
      "contribution-unavailable",
      "contribution-rejected",
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

it("translates every API code in both locales and preserves the AI HTTP statuses", () => {
  for (const locale of ["da", "en"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../../web/messages/${locale}/errors.json`, import.meta.url), "utf8"),
    ) as { api: Record<string, string> };
    for (const key of ApiErrorCode.options) expect(messages.api[key]?.length).toBeGreaterThan(0);
  }
  for (const [key, status] of [
    ["ai-disabled", 409],
    ["ai-not-configured", 503],
    ["ai-cap-reached", 429],
    ["ai-unavailable", 503],
    ["ai-rejected", 502],
    ["push-not-configured", 503],
  ] as const) {
    expect(toApiError(new HttpError(status, key))).toEqual({
      status,
      body: { error: { code: key, message: key } },
    });
  }
  expect(toApiError(new HttpError(400, "ai-not-configured")).status).toBe(400);
});
