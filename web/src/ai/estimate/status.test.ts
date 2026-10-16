// @vitest-environment node
import { HttpError } from "@frejsi/shared";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { expect, it } from "vitest";
import { actor } from "@/lib/foods/test-fixture.test";
import { estimateStatus } from "./status";

it("hides capture when disabled, unconfigured, unavailable or capped, with carers excluding the asker and viewers", async () => {
  const fake = new FakeAiProvider();
  const deps = {
    provider: () => Promise.resolve(fake),
    members: () =>
      Promise.resolve([
        { userId: "u1", role: "carer", user: { name: "Asker" } },
        { userId: "u2", role: "owner", user: { name: "Rowan" } },
        { userId: "u3", role: "viewer", user: { name: "Sky" } },
      ]),
    remaining: () => Promise.resolve(true),
  };
  expect(await estimateStatus("s1", actor, deps)).toEqual({ available: true, carers: ["Rowan"] });
  expect(
    await estimateStatus("s1", actor, { ...deps, remaining: () => Promise.resolve(false) }),
  ).toEqual({ available: false, carers: ["Rowan"] });
  for (const code of ["ai-disabled", "ai-not-configured", "ai-unavailable"] as const) {
    expect(
      await estimateStatus("s1", actor, {
        ...deps,
        provider: () => Promise.reject(new HttpError(503, code)),
      }),
    ).toEqual({ available: false, carers: ["Rowan"] });
  }
  expect(fake.calls).toEqual([]);
});
