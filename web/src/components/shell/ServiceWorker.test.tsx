import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceWorker } from "./ServiceWorker";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ServiceWorker", () => {
  function stubRegistration(): ReturnType<typeof vi.fn> {
    const register = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    return register;
  }

  it("registers the worker under the build version in production, so a release is a new worker with its own cache", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "v0.5.1");
    const register = stubRegistration();
    render(<ServiceWorker />);
    expect(register).toHaveBeenCalledWith("/sw.js?v=v0.5.1");
  });

  it("escapes a version that is not URL-safe, and falls back to dev without one", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "preview-abc/123");
    const register = stubRegistration();
    render(<ServiceWorker />);
    expect(register).toHaveBeenCalledWith("/sw.js?v=preview-abc%2F123");
    cleanup();
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", undefined);
    render(<ServiceWorker />);
    expect(register).toHaveBeenLastCalledWith("/sw.js?v=dev");
  });

  it("registers nothing outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const register = stubRegistration();
    render(<ServiceWorker />);
    expect(register).not.toHaveBeenCalled();
  });
});
