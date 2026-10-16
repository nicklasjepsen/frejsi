// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => ({ enabled: true, find: vi.fn() }));
vi.mock("@frejsi/shared", async (actual) => ({
  ...(await actual<object>()),
  prisma: { space: { findUniqueOrThrow: settings.find } },
}));
import { type EmitFn } from "@frejsi/shared";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryInsightRepository } from "@frejsi/shared/insights/memory";
import { createInsight } from "@frejsi/shared/insights/store";
import { configureInsights } from "@/ai/insight/service";
import { FakeLiveDb, captureLog, liveRequest, spaceContext } from "@/lib/live/test-support";
import { MemoryHistoryRepository } from "@/lib/history/memory";
import { configureHistory } from "@/lib/history/server";
import { GET as meal } from "@/app/api/spaces/[spaceId]/meals/[mealId]/insight/route";
import { GET, PATCH } from "./route";
const now = new Date("2026-10-18T18:00:00Z");
let history: MemoryHistoryRepository;
let repo: MemoryInsightRepository;
let provider: FakeAiProvider;
let emit: ReturnType<typeof vi.fn<EmitFn>>;
let logs: ReturnType<typeof captureLog>;
const request = (
  session: string | null,
  edit = false,
  questions = ["What patterns appeared after lunch?"],
) => {
  const req = liveRequest("s1", "history/week/insight", session, { start: "2026-10-12" });
  return edit
    ? new Request(req, {
        method: "PATCH",
        headers: { cookie: req.headers.get("cookie") ?? "", "content-type": "application/json" },
        body: JSON.stringify({ questions }),
      })
    : req;
};
const mealRequest = (session: string | null) =>
  meal(liveRequest("s1", "meals/meal/insight", session), {
    params: Promise.resolve({ spaceId: "s1", mealId: "meal" }),
  });
beforeEach(() => {
  const auth = new FakeLiveDb(() => now);
  auth.addSpace("s1");
  auth.addSpace("s2");
  for (const role of ["owner", "carer", "viewer"] as const) auth.addMember(role, "s1", role);
  auth.addMember("other", "s2", "owner");
  history = new MemoryHistoryRepository();
  history.spaces.set("s1", { timezone: "Europe/Copenhagen", target: { low: 4, high: 10 } });
  history.meals.push({
    id: "meal",
    spaceId: "s1",
    ts: "2026-10-18T10:00:00Z",
    totalCarbs: 42,
    items: [{ name: "Fictional pasta", carbs: 42 }],
    byUser: { id: "carer", name: "Fictional member" },
  });
  configureHistory({ repo: history, sessionDb: auth.db, now: () => now, photos: null });
  repo = new MemoryInsightRepository();
  provider = new FakeAiProvider(() => ({
    kind: "json",
    json: { text: "The meal contained 42 grams of carbs." },
    model: "fixture",
  }));
  const capped = new CappedAiProvider(provider, new MemoryAiCallRepository(), {
    spaceId: "s1",
    timezone: "Europe/Copenhagen",
  });
  emit = vi.fn<EmitFn>();
  configureInsights({
    repo,
    emit,
    provider: () => {
      if (!settings.enabled) throw new Error("Unexpected provider call");
      return capped;
    },
  });
  settings.enabled = true;
  settings.find.mockImplementation(() =>
    Promise.resolve({
      aiEnabled: settings.enabled,
      aiProvider: "anthropic",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mmol",
    }),
  );
  logs = captureLog();
});
afterEach(() => {
  configureHistory({});
  configureInsights({});
  vi.restoreAllMocks();
});
it("gates every method before repository access", async () => {
  const find = vi.spyOn(repo, "find");
  for (const [session, status] of [
    ["sess-viewer", 403],
    ["sess-other", 404],
    [null, 403],
  ] as const) {
    expect((await mealRequest(session)).status).toBe(status);
    expect((await GET(request(session), spaceContext("s1"))).status).toBe(status);
    expect((await PATCH(request(session, true), spaceContext("s1"))).status).toBe(status);
  }
  expect(history.calls).toEqual([]);
  expect(find).not.toHaveBeenCalled();
  expect(provider.calls).toHaveLength(0);
});
it("generates a meal once and rejects a member's request for a foreign meal", async () => {
  expect(await (await mealRequest("sess-owner")).json()).toMatchObject({
    state: "ready",
    text: "The meal contained 42 grams of carbs.",
  });
  await mealRequest("sess-carer");
  expect(provider.calls).toHaveLength(1);
  expect(repo.rows[0]?.provider).toBe("anthropic");
  expect(emit).toHaveBeenCalledTimes(1);
  const call = provider.calls[0];
  expect(call?.kind).toBe("complete");
  expect(JSON.stringify(call)).not.toMatch(/readings|byUser|Fictional member|T10:00:00/);
  const row = history.meals[0];
  if (!row) throw new Error("Missing fixture");
  row.spaceId = "s2";
  expect((await mealRequest("sess-owner")).status).toBe(404);
});
it("reads weekly cache only, edits guarded questions, and never logs text", async () => {
  expect(await (await GET(request("sess-owner"), spaceContext("s1"))).json()).toMatchObject({
    state: "pending",
    readyAt: "2026-10-18T16:00:00.000Z",
  });
  await createInsight(repo, emit, {
    spaceId: "s1",
    kind: "week",
    subjectKey: "2026-10-12",
    statsHash: "hash",
    text: "Recorded meals appear through the week.",
    questions: ["What patterns appeared this week?"],
    rejectedCount: 1,
    provider: "fake",
    model: "fixture",
  });
  expect(await (await GET(request("sess-carer"), spaceContext("s1"))).json()).toMatchObject({
    state: "ready",
    rejectedCount: 1,
    questionsEdited: false,
  });
  expect(await (await PATCH(request("sess-owner", true), spaceContext("s1"))).json()).toMatchObject(
    { questionsEdited: true, questions: ["What patterns appeared after lunch?"] },
  );
  expect(
    (
      await PATCH(
        request("sess-owner", true, ["Should I take insulin at lunch?"]),
        spaceContext("s1"),
      )
    ).status,
  ).toBe(502);
  expect(provider.calls).toHaveLength(0);
  expect(logs.all()).not.toMatch(/Recorded meals|patterns|insulin/);
  settings.enabled = false;
  expect(await (await GET(request("sess-owner"), spaceContext("s1"))).json()).toMatchObject({
    state: "off",
  });
});
