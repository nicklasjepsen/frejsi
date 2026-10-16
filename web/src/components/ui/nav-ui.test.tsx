import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../../messages/da";

import { ArrowNav, ChipGroup, PageHeader } from "./index";

afterEach(cleanup);
const mount = (children: ReactNode) =>
  render(
    <NextIntlClientProvider locale="da" messages={messages}>
      {children}
    </NextIntlClientProvider>,
  );
const css = readFileSync(path.join(import.meta.dirname, "nav-ui.module.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
};

describe("ChipGroup", () => {
  const options = [
    { value: "uge", label: "Uge" },
    { value: "dag", label: "Dag" },
    { value: "maaltider", label: "Måltider" },
  ];

  it("is a radiogroup of 38 px chips with exactly one pressed, and buttons call onChange", () => {
    const onChange = vi.fn();
    mount(<ChipGroup label="Visning" options={options} value="uge" onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Visning" });
    const chips = screen.getAllByRole("radio");
    expect(group).toContainElement(chips[0] ?? null);
    expect(chips.map((c) => c.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(chips[0]?.tagName).toBe("BUTTON");
    fireEvent.click(screen.getByRole("radio", { name: "Dag" }));
    expect(onChange).toHaveBeenCalledWith("dag");
    expect(block(".chip {")).toContain("min-height: 38px");
  });

  it("moves with the arrow keys and keeps one chip in the tab order", () => {
    const onChange = vi.fn();
    mount(<ChipGroup label="Visning" options={options} value="uge" onChange={onChange} />);
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1]);
    chips[0]?.focus();
    fireEvent.keyDown(chips[0] ?? document.body, { key: "ArrowRight" });
    expect(chips[1]).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("dag");
  });

  it("renders links when the options have an href", () => {
    mount(
      <ChipGroup
        label="Sammenligning"
        options={[
          { value: "one", label: "Kun denne gang", href: "/da/meal/m1?compare=0" },
          { value: "five", label: "Sammen med de sidste 5 gange", href: "/da/meal/m1" },
        ]}
        value="five"
      />,
    );
    const link = screen.getByRole("radio", { name: "Sammen med de sidste 5 gange" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/da/meal/m1");
    expect(link).toHaveAttribute("aria-checked", "true");
  });
});

describe("ArrowNav", () => {
  it("renders two 40×40 r10 arrow buttons with their labels and the optional label between", () => {
    const previous = vi.fn();
    mount(
      <ArrowNav
        previous={{ label: "Forrige måltid", onClick: previous }}
        next={{ label: "Næste måltid", disabled: true }}
        label="forrige / næste måltid"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forrige måltid" }));
    expect(previous).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Næste måltid" })).toBeDisabled();
    expect(screen.getByText("forrige / næste måltid")).toBeInTheDocument();
    expect(block(".arrow {")).toMatch(/width: 40px[\s\S]*height: 40px[\s\S]*border-radius: 10px/);
    expect(block(".navLabel {")).toMatch(/font-size: 13px[\s\S]*var\(--text-muted\)/);
  });

  it("renders links for an href and no label when none is given", () => {
    const { container } = mount(
      <ArrowNav
        previous={{ label: "Forrige uge", href: "/da/history/week?start=2026-10-05" }}
        next={{ label: "Næste uge", href: "/da/history/week?start=2026-10-19" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Forrige uge" })).toHaveAttribute(
      "href",
      "/da/history/week?start=2026-10-05",
    );
    expect(container.querySelector("[data-part=label]")).toBeNull();
  });
});

describe('PageHeader variant="meta" (Maaltid-Telefon)', () => {
  it("has the shared 48 px back link with its chevron, a centred muted line and a trailing link", () => {
    mount(
      <PageHeader
        variant="meta"
        meta="I dag 12:10 · Jonas"
        backHref="/da/history"
        trailing={<a href="#ret">Ret</a>}
      />,
    );
    const back = screen.getByRole("link", { name: "Tilbage" });
    expect(back).toHaveAttribute("href", "/da/history");
    expect(back.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("I dag 12:10 · Jonas")).toHaveAttribute("data-part", "meta");
    expect(screen.getByRole("link", { name: "Ret" })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(css).not.toContain(".metaBack");
    expect(block(".metaLine {")).toMatch(/font-size: 14px[\s\S]*var\(--text-muted\)/);
    expect(block(".metaTrailing {")).toMatch(/min-width: 48px[\s\S]*font-size: 15px/);
  });

  it("keeps the back button's place with a 48 px spacer when there is no way back", () => {
    const { container } = mount(<PageHeader variant="meta" meta="I går 18:40" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("header > span[aria-hidden=true]")).not.toBeNull();
    expect(block(".metaSpacer {")).toMatch(/width: 48px[\s\S]*height: 48px/);
  });

  it("takes a back button too", () => {
    const back = vi.fn();
    mount(<PageHeader variant="meta" meta="I går 18:40" onBack={back} />);
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    expect(back).toHaveBeenCalledOnce();
  });
});
