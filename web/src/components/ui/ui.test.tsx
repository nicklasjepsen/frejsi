import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Card } from "./Card";
import { Checkbox } from "./Checkbox";
import { Kbd } from "./Kbd";
import { Notice } from "./Notice";

const css = readFileSync(path.join(import.meta.dirname, "ui.module.css"), "utf8");

describe("ui", () => {
  it("keeps hover styles for pointers that hover, so a tap never leaves a button stuck", () => {
    const hoverMedia = css.indexOf("@media (hover: hover)");
    expect(hoverMedia).toBeGreaterThanOrEqual(0);
    for (const match of css.matchAll(/:hover/g)) expect(match.index).toBeGreaterThan(hoverMedia);
  });

  it("Checkbox is one labelled 44 px row with the accent box, shared by every form", () => {
    const onChange = vi.fn();
    render(<Checkbox label="Favourite" checked={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Favourite" });
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledOnce();
    expect(box.closest("label")?.className).toMatch(/checkbox/);
    expect(css).toMatch(/\.checkbox \{[^}]*min-height: var\(--touch-min\)/);
    expect(css).toMatch(
      /\.checkbox input \{[^}]*flex-shrink: 0;[^}]*accent-color: var\(--accent-base\)/,
    );
  });

  it("Avatar shows the first letter of the name and hides it from screen readers", () => {
    const { container } = render(<Avatar name="Example Person" size={36} />);
    const el = container.firstElementChild;
    expect(el).toHaveTextContent("E");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveStyle({ width: "36px", height: "36px" });
  });

  it("Avatar falls back to a middle dot for an empty name", () => {
    const { container } = render(<Avatar name="  " size={28} />);
    expect(container.firstElementChild).toHaveTextContent("·");
  });

  it("Button renders a link when given an href and a button otherwise", () => {
    render(
      <>
        <Button href="/da/now">Go</Button>
        <Button variant="secondary">Press</Button>
      </>,
    );
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/da/now");
    expect(screen.getByRole("button", { name: "Press" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
  });

  it("Card, Notice and Kbd render their children", () => {
    render(
      <Card>
        <Notice>Calm words</Notice>
        <Kbd>N</Kbd>
      </Card>,
    );
    expect(screen.getByText("Calm words")).toBeInTheDocument();
    expect(screen.getByText("N").tagName).toBe("KBD");
  });
});
