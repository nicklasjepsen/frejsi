import { describe, expect, it } from "vitest";

import { createLogger, LOG_KEYS } from "./log";

describe("log", () => {
  it("writes one JSON line with only allow-listed keys", () => {
    const lines: string[] = [];
    const log = createLogger(
      (line) => lines.push(line),
      () => new Date("2026-10-15T08:00:00.000Z"),
    );
    log.info("session.loaded", {
      userId: "u1",
      spaceId: "s1",
      count: 2,
      code: "ok",
      ms: 12,
      route: "/api/health",
      name: "Example Person",
      email: "person@example.invalid",
      token: "secret-token",
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      ts: "2026-10-15T08:00:00.000Z",
      level: "info",
      msg: "session.loaded",
      userId: "u1",
      spaceId: "s1",
      count: 2,
      code: "ok",
      ms: 12,
      route: "/api/health",
    });
    expect(lines[0]).not.toContain("Example Person");
    expect(lines[0]).not.toContain("example.invalid");
    expect(lines[0]).not.toContain("secret-token");
  });

  it("drops an allow-listed key whose value is not a string or number", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    log.warn("odd", { userId: { name: "Example Person" } as unknown as string, count: "3" });
    expect(lines[0]).not.toContain("Example Person");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "warn", msg: "odd", count: "3" });
  });

  it("has exactly the allow-list from the plan", () => {
    expect([...LOG_KEYS]).toEqual(["spaceId", "userId", "count", "code", "ms", "route"]);
  });

  it("logs errors by code only, never by message", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    log.error("poll.failed", { spaceId: "s1", code: "unreachable" }, new Error("pw=hunter2"));
    expect(lines[0]).not.toContain("hunter2");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "error",
      code: "unreachable",
      error: "Error",
    });
  });
});
