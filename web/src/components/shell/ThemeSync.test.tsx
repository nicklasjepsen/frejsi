import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { applyTheme } from "@/lib/theme/theme";

import { ThemeSync } from "./ThemeSync";

afterEach(() => {
  cleanup();
  applyTheme("system");
});

describe("ThemeSync", () => {
  it("applies the stored theme to a device whose cookie does not have it yet", () => {
    render(<ThemeSync theme="dark" />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("frejsi_theme=dark");
  });

  it("clears a forced theme the person has since set back to system", () => {
    applyTheme("light");
    render(<ThemeSync theme="system" />);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.cookie).not.toContain("frejsi_theme");
  });

  it("leaves the document alone when it already agrees", () => {
    applyTheme("dark");
    document.cookie = "frejsi_theme=dark; Path=/; Max-Age=5";
    render(<ThemeSync theme="dark" />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("frejsi_theme=dark");
  });
});
