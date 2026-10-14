import { describe, expect, it } from "vitest";

import { MemoryEventSink } from "./memory";
import type { EventSink, LiveTokenIssuer } from "./types";

describe("MemoryEventSink", () => {
  it("satisfies EventSink and LiveTokenIssuer and records what was published per group", async () => {
    const sink = new MemoryEventSink();
    const asSink: EventSink = sink;
    const asIssuer: LiveTokenIssuer = sink;
    const envelope = {
      spaceId: "s1",
      seq: 1,
      ts: "2026-10-15T08:00:00.000Z",
      type: "member.removed" as const,
      payload: { userId: "u1" },
    };
    await asSink.publish("space-s1", envelope);
    expect(sink.published).toEqual([{ group: "space-s1", envelope }]);
    expect(sink.forGroup("space-s1")).toEqual([envelope]);
    expect(sink.forGroup("space-s1-glucose")).toEqual([]);

    const token = await asIssuer.issueClientToken({ userId: "u1", groups: ["space-s1"] });
    expect(token?.url).toContain("space-s1");
    expect(sink.tokens).toEqual([{ userId: "u1", groups: ["space-s1"] }]);
  });
});
