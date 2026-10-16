import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lockScroll, unlockScroll, useDialogScrollLock } from "./useScrollLock";

const flush = () => act(() => Promise.resolve());

let dialog: HTMLDialogElement;
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  document.documentElement.style.overflow = "";
  document.body.removeAttribute("style");
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
});
afterEach(() => {
  cleanup();
  dialog.remove();
  vi.unstubAllGlobals();
});

describe("useDialogScrollLock", () => {
  it("fixes the body in place while the dialog is open and puts it back on close", async () => {
    document.body.style.position = "relative";
    renderHook(() => {
      useDialogScrollLock({ current: dialog });
    });
    expect(document.body.style.position).toBe("relative");

    dialog.setAttribute("open", "");
    await flush();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.body.style.width).toBe("100%");
    expect(dialog.style.overscrollBehavior).toBe("contain");

    // A fixed body has no scroll offset; un-fixing it must put the page back where it was.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    dialog.removeAttribute("open");
    await flush();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.top).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it("locks a dialog that is already open when the hook mounts, and unlocks on unmount", () => {
    dialog.setAttribute("open", "");
    const { unmount } = renderHook(() => {
      useDialogScrollLock({ current: dialog });
    });
    expect(document.body.style.position).toBe("fixed");
    unmount();
    expect(document.body.style.position).toBe("");
    expect(dialog.style.overscrollBehavior).toBe("");
  });

  it("does nothing without a dialog", () => {
    renderHook(() => {
      useDialogScrollLock({ current: null });
    });
    expect(document.body.style.position).toBe("");
  });
});

describe("lockScroll / unlockScroll", () => {
  it("counts locks, so the page is released only when the last sheet closes", () => {
    lockScroll();
    lockScroll();
    expect(document.body.style.position).toBe("fixed");
    unlockScroll();
    expect(document.body.style.position).toBe("fixed");
    unlockScroll();
    expect(document.body.style.position).toBe("");
    // One unlock too many changes nothing.
    unlockScroll();
    expect(document.body.style.position).toBe("");
  });
});
