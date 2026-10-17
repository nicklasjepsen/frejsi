// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEnvelope, EventPayloads, type EmitFn } from "@frejsi/shared";
import { FakeLiveDb, captureLog } from "@/lib/live/test-support";
import { configureSymptoms } from "@/lib/symptoms/server";
import { NAMES, database } from "@/lib/symptoms/test-support";
import { GET, POST } from "./route";
import { GET as KINDS } from "./kinds/route";
import { PATCH, DELETE } from "./[symptomId]/route";

/** Keys that carry glucose (web/e2e/support.ts); a symptom answer never has one at any depth. */
const GLUCOSE_KEYS = new Set(["mmol", "mgdl", "trend", "reading", "readings", "glucose", "stats"]);
function assertNoGlucose(value: unknown): void {
  if (Array.isArray(value)) value.forEach(assertNoGlucose);
  else if (value !== null && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      expect(GLUCOSE_KEYS.has(key), key).toBe(false);
      assertNoGlucose(item);
    }
}
// Anchored to real time: the request schema keeps a symptom within seven days of now.
const at = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const ctx = (symptomId = "missing", spaceId = "s1") => ({
  params: Promise.resolve({ spaceId, symptomId }),
});
const request = (method: string, user = "carer", body?: unknown, query = "") =>
  new Request(`https://frejsi.example.invalid/api/spaces/s1/symptoms${query}`, {
    method,
    headers: { cookie: `frejsi_session=sess-${user}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const range = () => {
  const from = new Date(at.getTime() - 24 * 60 * 60_000).toISOString();
  const to = new Date(at.getTime() + 10 * 60_000).toISOString();
  return `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};
let auth: FakeLiveDb;
let events: string[];
let logs: ReturnType<typeof captureLog>;
let store: ReturnType<typeof database>;
beforeEach(() => {
  auth = new FakeLiveDb(() => at);
  auth.addSpace("s1");
  auth.addMember("owner", "s1", "owner");
  auth.addMember("carer", "s1", "carer");
  auth.addMember("child", "s1", "carer");
  auth.addMember("viewer", "s1", "viewer");
  auth.addMember("other", "s2", "carer");
  const child = auth.users.find((u) => u.id === "child");
  if (child) child.simpleMode = true;
  events = [];
  logs = captureLog();
  store = database({
    symptomKinds: JSON.stringify([{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }]),
  });
  const emit: EmitFn = (spaceId, type, payload) => {
    events.push(type);
    return Promise.resolve(
      EventEnvelope.parse({
        spaceId,
        seq: events.length,
        type,
        payload: EventPayloads[type].parse(payload),
        ts: at.toISOString(),
      }),
    );
  };
  configureSymptoms({
    sessionDb: auth.db,
    repo: store.repo,
    write: (work) => work(store.repo, emit),
    now: () => at,
  });
});
afterEach(() => {
  configureSymptoms({});
});

describe("symptom routes", () => {
  it.each(["owner", "carer"])(
    "%s creates with 201 and the view, one symptom.created in the same write",
    async (user) => {
      const response = await POST(request("POST", user, { kind: "stomach-ache" }), ctx());
      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toEqual({
        id: expect.any(String),
        kind: "stomach-ache",
        ts: at.toISOString(),
        byUserId: user,
        byName: NAMES[user],
      });
      expect(events).toEqual(["symptom.created"]);
      expect(logs.all()).not.toMatch(/stomach|Fictional/);
      expect(logs.all()).toContain('"count":1');
    },
  );
  it("is 403 for a viewer on every write, 404 for a non-member, 403 without a session", async () => {
    for (const [handler, method, body] of [
      [POST, "POST", { kind: "tired" }],
      [PATCH, "PATCH", { kind: "tired" }],
      [DELETE, "DELETE", undefined],
    ] as const) {
      expect((await handler(request(method, "viewer", body), ctx())).status).toBe(403);
      expect((await handler(request(method, "unknown", body), ctx())).status).toBe(403);
      expect((await handler(request(method, "other", body), ctx())).status).toBe(404);
    }
    expect((await GET(request("GET", "other", undefined, range()), ctx())).status).toBe(404);
    expect((await GET(request("GET", "unknown", undefined, range()), ctx())).status).toBe(403);
    expect(events).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
  it("lets a simpleMode session create a kind only, and never edit or delete afterwards", async () => {
    const created = await POST(request("POST", "child", { kind: "tired" }), ctx());
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    for (const body of [
      { kind: "tired", severity: "light" },
      { kind: "tired", note: "Fictional" },
      { kind: "tired", ts: at.toISOString() },
    ]) {
      const refused = await POST(request("POST", "child", body), ctx());
      expect(refused.status).toBe(400);
      expect(await refused.json()).toHaveProperty("error.code", "simple-mode");
    }
    const patched = await PATCH(request("PATCH", "child", { severity: "light" }), ctx(id));
    expect(patched.status).toBe(400);
    expect(await patched.json()).toHaveProperty("error.code", "simple-mode");
    const deleted = await DELETE(request("DELETE", "child"), ctx(id));
    expect(deleted.status).toBe(400);
    expect(await deleted.json()).toHaveProperty("error.code", "simple-mode");
    expect(events).toEqual(["symptom.created"]);
    expect(store.rows.size).toBe(1);
  });
  it("refuses a kind outside the defaults and the space's kinds with symptom-kind-unknown", async () => {
    const refused = await POST(request("POST", "carer", { kind: "custom:other" }), ctx());
    expect(refused.status).toBe(400);
    expect(await refused.json()).toHaveProperty("error.code", "symptom-kind-unknown");
    expect((await POST(request("POST", "carer", { kind: "custom:itchy" }), ctx())).status).toBe(
      201,
    );
    expect((await POST(request("POST", "carer", { kind: "sad" }), ctx())).status).toBe(400);
    expect((await POST(request("POST", "carer", "nope"), ctx())).status).toBe(400);
    expect(events).toEqual(["symptom.created"]);
  });
  it("lists the range for every role including the viewer, oldest first, with byName and nothing from Reading", async () => {
    auth.addReading("s1", { ts: at.toISOString(), mmol: 6.4, trend: "flat" });
    await POST(request("POST", "child", { kind: "dizzy" }), ctx());
    await POST(
      request("POST", "carer", {
        kind: "tired",
        ts: new Date(at.getTime() - 60_000).toISOString(),
        note: "Fictional note",
      }),
      ctx(),
    );
    for (const user of ["viewer", "owner", "carer", "child"]) {
      const response = await GET(request("GET", user, undefined, range()), ctx());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { symptoms: Record<string, unknown>[] };
      expect(body.symptoms.map((s) => [s.kind, s.byName])).toEqual([
        ["tired", "Fictional carer"],
        ["dizzy", "Fictional child"],
      ]);
      assertNoGlucose(body);
    }
    expect((await GET(request("GET", "viewer"), ctx())).status).toBe(400);
    expect(logs.all()).not.toMatch(/Fictional|dizzy|tired/);
  });
  it("answers the space's own kinds to every role", async () => {
    for (const user of ["viewer", "carer", "child"]) {
      const response = await KINDS(request("GET", user), ctx());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        kinds: [{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }],
      });
    }
    expect((await KINDS(request("GET", "other"), ctx())).status).toBe(404);
  });
  it("updates and deletes as owner or carer with symptom.updated and symptom.deleted; a carer deletes the child's", async () => {
    const created = await POST(request("POST", "child", { kind: "nausea" }), ctx());
    const { id } = (await created.json()) as { id: string };
    const patched = await PATCH(
      request("PATCH", "owner", { severity: "strong", resolvedTs: at.toISOString() }),
      ctx(id),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      severity: "strong",
      resolvedTs: at.toISOString(),
      byUserId: "child",
    });
    const cleared = await PATCH(request("PATCH", "carer", { resolvedTs: null }), ctx(id));
    expect(await cleared.json()).not.toHaveProperty("resolvedTs");
    expect((await PATCH(request("PATCH", "carer", { nope: 1 }), ctx(id))).status).toBe(400);
    expect((await DELETE(request("DELETE", "carer"), ctx(id))).status).toBe(204);
    expect((await DELETE(request("DELETE", "carer"), ctx(id))).status).toBe(404);
    expect(await (await PATCH(request("PATCH", "carer", { kind: "tired" }), ctx(id))).json()).toHaveProperty(
      "error.code",
      "symptom-not-found",
    );
    expect(events).toEqual([
      "symptom.created",
      "symptom.updated",
      "symptom.updated",
      "symptom.deleted",
    ]);
    expect(store.rows.size).toBe(0);
  });
});
