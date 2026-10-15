// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAuthDb, recordingSink, type RecordedEvent } from "@/lib/auth/test-support";

import { POST } from "./route";

const shared = vi.hoisted(() => {
  const holder: { db: Record<string, unknown>; sink: EventSink } = {
    db: {},
    sink: { publish: () => Promise.resolve() },
  };
  // core.ts caches the sink it builds once, so this one forwards to whatever the test set.
  const sink: EventSink = { publish: (group, envelope) => holder.sink.publish(group, envelope) };
  return {
    holder,
    prisma: new Proxy({}, { get: (_target, key: string) => holder.db[key] }),
    sink,
  };
});
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: shared.prisma,
  createEventSinkFromEnv: () => shared.sink,
}));

const ORIGIN = "https://frejsi.example";
const TOKEN = "example-bootstrap-token-0123456789";
const T0 = new Date("2026-10-15T08:00:00.000Z");
const body = {
  spaceName: "Example space",
  ownerName: "Example Owner",
  timezone: "Europe/Copenhagen",
};

let fake: FakeAuthDb;
let events: RecordedEvent[];
let logLines: string[];

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  process.env.APP_ORIGIN = ORIGIN;
  process.env.BOOTSTRAP_TOKEN = TOKEN;
  fake = new FakeAuthDb(() => T0);
  const recorder = recordingSink();
  events = recorder.events;
  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  shared.holder.sink = recorder.sink;
  logLines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    logLines.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.APP_ORIGIN;
  delete process.env.BOOTSTRAP_TOKEN;
});

function post(payload: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["x-bootstrap-token"] = token;
  return new Request(`${ORIGIN}/api/bootstrap`, {
    method: "POST",
    headers,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("POST /api/bootstrap", () => {
  it("creates the first space and returns the owner invite URL once, with invite.created emitted", async () => {
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    const result = (await res.json()) as { spaceId: string; inviteUrl: string; expiresAt: string };
    const token = fake.rows("invite")[0]?.token as string;
    expect(result.inviteUrl).toBe(`${ORIGIN}/invite/${token}`);
    expect(result.expiresAt).toBe("2026-10-22T08:00:00.000Z");
    expect(fake.rows("space")).toEqual([
      expect.objectContaining({ id: result.spaceId, timezone: "Europe/Copenhagen" }),
    ]);
    expect(events.map((e) => e.type)).toEqual(["member.joined", "invite.created"]);

    const again = await POST(post(body));
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ error: { code: "not-found" } });
    expect(fake.rows("space")).toHaveLength(1);
  });

  it("answers 401 on a wrong or missing token and writes nothing", async () => {
    const wrong = await POST(post(body, "wrong"));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: { code: "forbidden" } });
    const missing = await POST(post(body, null));
    expect(missing.status).toBe(401);
    expect(fake.rows("space")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("answers 400 validation for a bad body or no JSON", async () => {
    expect((await POST(post({ ...body, timezone: "nowhere" }))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
    expect(fake.rows("space")).toEqual([]);
  });

  it("writes no log line that contains the token or the URL", async () => {
    const res = await POST(post(body));
    const { inviteUrl, spaceId } = (await res.json()) as { inviteUrl: string; spaceId: string };
    await POST(post(body, "wrong"));
    const all = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(inviteUrl);
    expect(all).not.toContain(fake.rows("invite")[0]?.token as string);
    expect(all).not.toContain("Example Owner");
    expect(all).toContain(`"spaceId":"${spaceId}"`);
  });
});
