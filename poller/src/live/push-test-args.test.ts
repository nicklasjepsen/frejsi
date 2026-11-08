import { describe, expect, it } from "vitest";

import { parsePushTestArgs } from "./push-test-args";

const now = new Date("2026-11-08T20:00:00.000Z");
const A = "ab".repeat(32);
const B = "cd".repeat(32);

describe("parsePushTestArgs", () => {
  it("has sandbox, 7 h 45 min, 30 s and priority 10 as defaults", () => {
    expect(parsePushTestArgs(["--activity-token", A], {}, now)).toEqual({
      activityToken: A,
      environment: "sandbox",
      csvPath: "push-test-2026-11-08T20-00-00-000Z.csv",
      restartAfterMs: 465 * 60_000,
      intervalMs: 30_000,
      priority: 10,
      once: false,
    });
  });

  it("reads every option, in both spellings, and tokens from the environment", () => {
    const args = parsePushTestArgs(
      [
        "--activity-token-file=token.txt",
        "--env",
        "production",
        "--csv=out.csv",
        "--restart-after",
        "10",
        "--interval=5",
        "--priority",
        "5",
        "--activity-started-at",
        "2026-11-08T19:00:00Z",
        "--once",
      ],
      { PUSH_TO_START_TOKEN: B.toUpperCase() },
      now,
    );
    expect(args).toEqual({
      activityTokenFile: "token.txt",
      pushToStartToken: B,
      environment: "production",
      csvPath: "out.csv",
      restartAfterMs: 600_000,
      intervalMs: 5000,
      priority: 5,
      activityStartedAt: Date.parse("2026-11-08T19:00:00Z"),
      once: true,
    });
    expect(parsePushTestArgs([], { LIVE_ACTIVITY_TOKEN: A }, now).activityToken).toBe(A);
  });

  it("refuses unknown, missing and malformed values without echoing a token", () => {
    const bad = "not-hex-secretish";
    expect(() => parsePushTestArgs(["--activity-token", bad], {}, now)).toThrow(
      "--activity-token must be a hex push token",
    );
    try {
      parsePushTestArgs(["--push-to-start-token", bad], {}, now);
    } catch (error) {
      expect(String(error)).not.toContain(bad);
    }
    expect(() => parsePushTestArgs(["--nope", "1"], {}, now)).toThrow("unknown option --nope");
    expect(() => parsePushTestArgs(["--csv"], {}, now)).toThrow("--csv needs a value");
    expect(() => parsePushTestArgs(["--env", "dev"], {}, now)).toThrow("sandbox or production");
    expect(() => parsePushTestArgs(["--priority", "7"], {}, now)).toThrow("5 or 10");
    expect(() => parsePushTestArgs(["--interval", "0"], {}, now)).toThrow("positive");
    expect(() => parsePushTestArgs(["--activity-started-at", "soon"], {}, now)).toThrow("ISO");
    expect(() =>
      parsePushTestArgs(["--activity-token", A, "--activity-token-file", "t"], {}, now),
    ).toThrow("not both");
    expect(() => parsePushTestArgs(["stray"], {}, now)).toThrow("unexpected argument");
  });
});
