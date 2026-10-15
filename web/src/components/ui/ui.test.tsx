import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Card } from "./Card";
import { Kbd } from "./Kbd";
import { Notice } from "./Notice";

describe("ui", () => {
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
