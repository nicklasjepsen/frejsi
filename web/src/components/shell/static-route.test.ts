import { HttpError } from "@frejsi/shared";
import { expect, it } from "vitest";
import { settingsRoute } from "@/components/settings/api-route";

it("keeps the forbidden response when Next supplies no params on a static route", async () => {
  const handler = settingsRoute("fixture.static", () => {
    throw new HttpError(403, "forbidden");
  });
  const context = { params: undefined } as unknown as { params: Promise<Record<string, never>> };
  const response = await handler(
    new Request("https://frejsi.example/api/users/me/push-subscriptions"),
    context,
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
});
