import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { PrismaPushRepository } from "./repository";

interface RecipientRow {
  id: string;
  spaceId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user: { locale: string; memberships: { spaceId: string; role: string }[] };
  session: { expiresAt: Date };
}
it("selects only current carers of the asking space with a live session, excluding the asker", async () => {
  const rows: RecipientRow[] = [
    "owner",
    "carer",
    "viewer",
    "removed",
    "expired",
    "asker",
    "other-space",
  ].map((id) => ({
    id,
    spaceId: id === "other-space" ? "s2" : "s1",
    userId: id,
    endpoint: `https://push.example/${id}`,
    p256dh: "fictional",
    auth: "fictional",
    user: {
      locale: id === "carer" ? "en" : "da",
      memberships:
        id === "removed"
          ? []
          : [
              {
                spaceId: "s1",
                role: id === "owner" ? "owner" : id === "viewer" ? "viewer" : "carer",
              },
            ],
    },
    session: { expiresAt: new Date(id === "expired" ? "2000-01-01" : "2099-01-01") },
  }));
  // The fake evaluates the production predicate, including omitted clauses, instead of returning
  // an already-filtered answer. Removing any role, space, session or asker filter changes output.
  const db = {
    pushSubscription: {
      findMany: (args: {
        where?: {
          spaceId?: string;
          userId?: { not?: string };
          session?: { expiresAt: { gt: Date } };
          user?: { memberships: { some: { spaceId: string; role: { in: string[] } } } };
        };
      }) =>
        Promise.resolve(
          rows.filter((r) => {
            const w = args.where;
            const member = w?.user?.memberships.some;
            return (
              (!w?.spaceId || w.spaceId === r.spaceId) &&
              (!w?.userId?.not || w.userId.not !== r.userId) &&
              (!w?.session || r.session.expiresAt > w.session.expiresAt.gt) &&
              (!member ||
                r.user.memberships.some(
                  (m) => m.spaceId === member.spaceId && member.role.in.includes(m.role),
                ))
            );
          }),
        ),
    },
  };
  const repo = new PrismaPushRepository(db as unknown as PrismaClient);
  expect(await repo.recipients("s1", "asker")).toEqual(
    ["owner", "carer"].map((id) => ({
      id,
      endpoint: `https://push.example/${id}`,
      keys: { p256dh: "fictional", auth: "fictional" },
      locale: id === "carer" ? "en" : "da",
    })),
  );
});
it("ties subscription deletion to session deletion at the database boundary", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const subscription = /model PushSubscription \{([\s\S]*?)\n\}/.exec(schema)?.[1];
  expect(subscription).toMatch(
    /session\s+Session\s+@relation\(fields: \[sessionId\], references: \[id\], onDelete: Cascade/,
  );
  expect(subscription).toContain("@@unique([userId, endpoint])");
});
