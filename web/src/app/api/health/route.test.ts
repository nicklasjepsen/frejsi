import { describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  prisma: {
    $queryRaw: () => Promise.resolve([{ ok: 1 }]),
    reading: { findFirst: () => Promise.resolve({ ts: new Date() }) },
  },
}));
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: shared.prisma,
}));

import { GET, dynamic } from "./route";

describe("GET /api/health", () => {
  it("is never cached and answers 200 with the Health body when the database answers", async () => {
    expect(dynamic).toBe("force-dynamic");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, db: "ok", readings: "fresh" });
  });

  it("answers 503 when the database does not answer", async () => {
    shared.prisma.$queryRaw = () => Promise.reject(new Error("down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: "error", readings: "none" });
  });
});
