import { afterEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ startTelemetry: vi.fn(() => Promise.resolve()) }));
vi.mock("@frejsi/shared", () => ({ startTelemetry: shared.startTelemetry }));

import { register } from "./instrumentation";

describe("instrumentation.register (plan §9)", () => {
  afterEach(() => {
    shared.startTelemetry.mockClear();
    vi.unstubAllEnvs();
  });

  it("starts App Insights through the shared initializer on the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(shared.startTelemetry).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the edge runtime, where the SDK cannot run", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(shared.startTelemetry).not.toHaveBeenCalled();
  });
});
