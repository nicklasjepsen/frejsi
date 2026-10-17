// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SessionContext, type EmitTx } from "@frejsi/shared";
import { MemoryEventSink } from "@frejsi/shared/events/memory";
import { createSymptom, deleteSymptom, updateSymptom } from "./service";
import { database } from "./test-support";
import { createSymptomWriter, type SymptomWriteDb } from "./transaction";

const session = SessionContext.parse({
  userId: "carer",
  name: "Fictional carer",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
});
function setup() {
  const { db, repo, rows } = database();
  const sink = new MemoryEventSink();
  const events: unknown[] = [];
  let sequence = 0;
  let failEvent = false;
  const sql = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const before = structuredClone(rows);
      const count = events.length;
      const seq = sequence;
      const tx = {
        ...db,
        space: {
          ...db.space,
          update: () => Promise.resolve({ lastSeq: ++sequence }),
        },
        event: {
          create: (args: Parameters<EmitTx["event"]["create"]>[0]) => {
            if (failEvent) return Promise.reject(new Error("transient-event-failure"));
            events.push(args.data);
            return Promise.resolve(args.data);
          },
        },
      };
      try {
        const result = await work(tx);
        // Nothing is published while the transaction is open.
        expect(sink.published).toHaveLength(count);
        return result;
      } catch (error) {
        rows.clear();
        for (const [id, row] of before) rows.set(id, row);
        events.splice(count);
        sequence = seq;
        throw error;
      }
    },
  };
  const deps = { repo, write: createSymptomWriter(sql as SymptomWriteDb, sink) };
  return {
    deps,
    events,
    sink,
    rows,
    failNext: () => {
      failEvent = true;
    },
  };
}
describe("atomic symptom writes and events", () => {
  it("rolls back a create when its event fails, publishing nothing", async () => {
    const test = setup();
    test.failNext();
    await expect(createSymptom("s1", session, { kind: "tired" }, test.deps)).rejects.toThrow(
      "transient",
    );
    expect(test.rows.size).toBe(0);
    expect(test.events).toHaveLength(0);
    expect(test.sink.published).toHaveLength(0);
  });
  it.each(["update", "delete"])("rolls back %s when its event fails", async (operation) => {
    const test = setup();
    const saved = await createSymptom("s1", session, { kind: "tired" }, test.deps);
    const before = structuredClone(test.rows);
    test.failNext();
    const result =
      operation === "update"
        ? updateSymptom("s1", saved.id, session, { severity: "light" }, test.deps)
        : deleteSymptom("s1", saved.id, session, test.deps);
    await expect(result).rejects.toThrow("transient");
    expect(test.rows).toEqual(before);
    expect(test.events).toHaveLength(1);
    expect(test.sink.published).toHaveLength(1);
  });
  it("publishes after commit, and keeps the row and its event when publication fails", async () => {
    const test = setup();
    vi.spyOn(test.sink, "publish").mockRejectedValue(new Error("unavailable"));
    const saved = await createSymptom("s1", session, { kind: "tired" }, test.deps);
    expect(test.rows.has(saved.id)).toBe(true);
    expect(test.events).toHaveLength(1);
    expect(test.sink.published.map((p) => p.envelope.type)).toEqual([]);
  });
  it("publishes exactly one symptom.created to the space group after a successful create", async () => {
    const test = setup();
    const saved = await createSymptom("s1", session, { kind: "dizzy" }, test.deps);
    expect(test.sink.published).toHaveLength(1);
    expect(test.sink.published[0]?.envelope).toMatchObject({
      spaceId: "s1",
      type: "symptom.created",
      payload: { symptomId: saved.id, kind: "dizzy", byUserId: "carer" },
    });
  });
});
