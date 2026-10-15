// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SessionContext, type EmitTx } from "@frejsi/shared";
import { MemoryEventSink } from "@frejsi/shared/events/memory";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { createMeal, updateMeal, deleteMeal, setMealPhoto } from "./service";
import { database } from "./test-support";
import { createMealWriter, type MealWriteDb } from "./transaction";

const session = SessionContext.parse({
  userId: "u1",
  name: "Fictional carer",
  simpleMode: false,
  accent: "olive",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
});
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
function setup() {
  const { db, repo, rows } = database();
  const sink = new MemoryEventSink();
  const photos = new MemoryPhotoStore();
  const events: unknown[] = [];
  let sequence = 0;
  let failEvent = false;
  let failCommit = false;
  const sql = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const before = structuredClone(rows);
      const count = events.length;
      const seq = sequence;
      const tx = {
        ...db,
        space: { update: () => Promise.resolve({ lastSeq: ++sequence }) },
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
        expect(sink.published).toHaveLength(count);
        if (failCommit) throw new Error("transient-commit-failure");
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
  const deps = { repo, photos, write: createMealWriter(sql as MealWriteDb, sink) };
  return {
    deps,
    events,
    sink,
    photos,
    rows,
    fail: (commit = false) => {
      failCommit = commit;
      failEvent = !commit;
    },
  };
}
describe("atomic meal writes and events", () => {
  it.each([false, true])(
    "rolls back create and its photo when event/commit fails (commit=%s)",
    async (commit) => {
      const test = setup();
      test.fail(commit);
      await expect(
        createMeal(
          "s1",
          session,
          { items: [{ name: "Fictional toast", carbs: 12 }], photoDataUrl: png },
          test.deps,
        ),
      ).rejects.toThrow("transient");
      expect(test.rows.size).toBe(0);
      expect(test.events).toHaveLength(0);
      expect(test.sink.published).toHaveLength(0);
      expect(test.photos.photos.size).toBe(0);
    },
  );
  it.each(["update", "delete", "photo-put", "photo-delete"])(
    "rolls back %s and retains the previous photo on event failure",
    async (operation) => {
      const test = setup();
      const meal = await createMeal(
        "s1",
        session,
        { items: [{ name: "Fictional toast", carbs: 12 }], photoDataUrl: png },
        test.deps,
      );
      const before = structuredClone(test.rows);
      const keys = [...test.photos.photos.keys()];
      test.fail();
      const result =
        operation === "update"
          ? updateMeal(
              "s1",
              meal.id,
              session,
              { items: [{ name: "Fictional oats", carbs: 20 }], photoDataUrl: png },
              test.deps,
            )
          : operation === "delete"
            ? deleteMeal("s1", meal.id, test.deps)
            : setMealPhoto(
                "s1",
                meal.id,
                session,
                operation === "photo-put" ? png : null,
                test.deps,
              );
      await expect(result).rejects.toThrow("transient");
      expect(test.rows).toEqual(before);
      expect([...test.photos.photos.keys()]).toEqual(keys);
      expect(test.events).toHaveLength(1);
      expect(test.sink.published).toHaveLength(1);
    },
  );
  it("publishes after commit, and keeps committed rows/events when publication fails", async () => {
    const test = setup();
    vi.spyOn(test.sink, "publish").mockRejectedValue(new Error("unavailable"));
    const meal = await createMeal(
      "s1",
      session,
      { items: [{ name: "Fictional toast", carbs: 12 }] },
      test.deps,
    );
    expect(test.rows.has(meal.id)).toBe(true);
    expect(test.events).toHaveLength(1);
  });
});
