// The build check (release.yml): the built app's `/api/health` reports the version the release
// built and deploys, says the database answers and that the seed's readings are fresh.
import { expect, test } from "@playwright/test";

test("/api/health reports the release version", async ({ request }) => {
  const expected = process.env.E2E_APP_VERSION;
  expect(expected).toBeTruthy();
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({
    ok: true,
    version: expected,
    db: "ok",
    readings: "fresh",
  });
});
