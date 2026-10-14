import { describe, expect, it } from "vitest";

import { parseCliArgs } from "./cli-args";

describe("poll CLI arguments", () => {
  it("accepts --once with an optional --space", () => {
    expect(parseCliArgs(["--once"])).toEqual({ once: true });
    expect(parseCliArgs(["--once", "--space", "abc"])).toEqual({ once: true, spaceId: "abc" });
    expect(parseCliArgs(["--space=abc", "--once"])).toEqual({ once: true, spaceId: "abc" });
  });

  it("refuses to run without --once: the timer is the Function, not this CLI", () => {
    expect(() => parseCliArgs([])).toThrow(/--once/);
    expect(() => parseCliArgs(["--space", "abc"])).toThrow(/--once/);
  });

  it("refuses an unknown flag or a missing space id", () => {
    expect(() => parseCliArgs(["--once", "--space"])).toThrow(/--space/);
    expect(() => parseCliArgs(["--once", "--loop"])).toThrow(/--loop/);
  });
});
