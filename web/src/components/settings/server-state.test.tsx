import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useServerState } from "./server-state";

afterEach(cleanup);

describe("useServerState", () => {
  it("starts from the props, keeps local writes while the props are the same object, and yields to new props", () => {
    const first = { items: ["a"] };
    const { result, rerender } = renderHook(({ source }) => useServerState(source, (s) => s.items), {
      initialProps: { source: first },
    });
    expect(result.current[0]).toEqual(["a"]);

    act(() => {
      result.current[1]((items) => [...items, "b"]);
    });
    expect(result.current[0]).toEqual(["a", "b"]);

    // The same props object again (a parent re-render without a refresh): the local write stays.
    rerender({ source: first });
    expect(result.current[0]).toEqual(["a", "b"]);

    // A refresh brings a new object from the server: it wins, the local layer is gone.
    const refreshed = { items: ["z"] };
    rerender({ source: refreshed });
    expect(result.current[0]).toEqual(["z"]);

    act(() => {
      result.current[1]((items) => [...items, "y"]);
    });
    expect(result.current[0]).toEqual(["z", "y"]);
  });
});
