import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackButton } from "./BackButton";

afterEach(cleanup);

const css = readFileSync(path.join(import.meta.dirname, "back-button.module.css"), "utf8");
const block = (selector: string, source = css) => {
  const start = source.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf("{", start), source.indexOf("}", start));
};

describe("BackButton (the one back control of every phone sub-screen and sheet)", () => {
  it("is a link named for the screen reader when given an href; the chevron is decoration", () => {
    render(<BackButton href="/da/settings" label="Tilbage" />);
    const link = screen.getByRole("link", { name: "Tilbage" });
    expect(link).toHaveAttribute("href", "/da/settings");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveTextContent("");
  });

  it("is a button otherwise, calls onClick, and does nothing while disabled", () => {
    const onClick = vi.fn();
    const view = render(<BackButton onClick={onClick} label="Tilbage" />);
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    expect(onClick).toHaveBeenCalledOnce();
    view.rerender(<BackButton onClick={onClick} label="Tilbage" disabled />);
    const button = screen.getByRole("button", { name: "Tilbage" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("draws the label next to the chevron when asked, and takes a size and an extra class", () => {
    render(<BackButton href="/da/settings" label="Tilbage til Mere" showLabel size="simple" className="extra" />);
    const link = screen.getByRole("link", { name: "Tilbage til Mere" });
    expect(link).toHaveTextContent("Tilbage til Mere");
    expect(link).toHaveAttribute("data-size", "simple");
    expect(link).toHaveAttribute("data-label", "true");
    expect(link.className).toContain("extra");
  });

  it("declares a 48 px hit area (56 in simpleMode), a 28 px glyph in the text colour, and pressed and focus states", () => {
    expect(block(".back {")).toMatch(/min-width: 48px[\s\S]*min-height: 48px/);
    expect(block(".back {")).toContain("color: var(--text)");
    expect(block(".back {")).not.toContain("background: transparent");
    expect(block(".back svg {")).toMatch(/width: 28px[\s\S]*height: 28px/);
    expect(block('.back[data-size="simple"] {')).toMatch(/min-width: 56px[\s\S]*min-height: 56px/);
    expect(block(".back:active {")).toContain("background");
    expect(block(".back:focus-visible {")).toContain("outline: 2px solid var(--accent-base)");
    // Tokens only, so dark mode and the accent follow.
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("is quieter from 1280 px but still at least 40 px", () => {
    const desktop = css.slice(css.indexOf("@media (min-width: 1280px)"));
    expect(block(".back {", desktop)).toMatch(/min-width: 40px[\s\S]*min-height: 40px/);
  });
});
