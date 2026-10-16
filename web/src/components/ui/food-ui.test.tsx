import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/da";
import {
  Badge,
  Chip,
  DataTable,
  ListRow,
  NumberInput,
  PageHeader,
  QuickLinkCard,
  TextInput,
} from "./index";
import type { ReactNode } from "react";

afterEach(cleanup);
const mount = (children: ReactNode) =>
  render(
    <NextIntlClientProvider locale="da" messages={messages}>
      {children}
    </NextIntlClientProvider>,
  );

describe("food UI primitives", () => {
  it("labels verification and exposes pressed chip state", () => {
    mount(
      <>
        <Badge verified={false} />
        <Badge verified />
        <Chip pressed variant="unverified">
          Filter
        </Chip>
      </>,
    );
    expect(screen.getByText("Ikke tjekket")).toHaveAttribute("data-variant", "unverified");
    expect(screen.getByText("Tjekket")).toHaveAttribute("data-variant", "checked");
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-pressed", "true");
  });
  it("food rows always show the unverified mark and keep trailing controls separate", () => {
    const activate = vi.fn();
    mount(
      <ListRow
        title="Fictional bread"
        verified={false}
        secondary="40 g"
        onClick={activate}
        trailing={<button>Check</button>}
      />,
    );
    expect(screen.getByText("Ikke tjekket")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Fictional bread" }));
    expect(activate).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Check" }).parentElement?.closest("button"),
    ).toBeNull();
  });
  it("makes the whole row the link, named by the title alone, with the trailing control above it", () => {
    const { container } = mount(
      <ListRow
        title="Fictional bread"
        verified
        href="/da/library/f-1"
        photo={<span>photo</span>}
        secondary="40 g per 100 g"
        trailing={<button>Check</button>}
      />,
    );
    // One link, named by the title: the subtitle stays ordinary text for screen readers.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Fictional bread" });
    expect(link).toHaveAttribute("href", "/da/library/f-1");
    // The link is stretched over the row: the row is its positioned ancestor, and the trailing
    // control is lifted above it so the only nested control still gets the tap.
    const row = container.firstElementChild;
    expect(row).toHaveAttribute("data-link", "true");
    expect(link.closest("[data-link]")).toBe(row);
    const trailing = screen.getByRole("button", { name: "Check" }).parentElement;
    expect(trailing?.className).toMatch(/trailing/);
    expect(trailing?.parentElement).toBe(row);
    const css = readFileSync(path.join(import.meta.dirname, "food-ui.module.css"), "utf8");
    expect(css).toMatch(/\.listRow \{[^}]*position: relative;/);
    expect(css).toMatch(
      /\.listRow\[data-link="true"\] \.foodTitle::after \{[^}]*position: absolute;[^}]*inset: 0;/,
    );
    expect(css).toMatch(/\.trailing \{[^}]*position: relative;[^}]*z-index: 1;/);
    // Filter chips are 44 px on the phone (the touch-min token); the desktop query keeps 36 px.
    expect(css).toMatch(/\.chip \{[^}]*min-height: 44px;/);
    expect(css.slice(css.indexOf("@media (min-width: 1280px)"))).toMatch(
      /\.chip \{[^}]*min-height: 36px;/,
    );
    expect(css).not.toMatch(/:hover/);
  });
  it("moves table focus with J/K, selects with Space, and activates with Enter", () => {
    const activate = vi.fn();
    mount(
      <DataTable
        rows={[
          { id: "a", name: "Fiction A" },
          { id: "b", name: "Fiction B" },
        ]}
        columns={[{ key: "name", header: "Food", render: (row) => row.name }]}
        rowLabel={(row) => row.name}
        onActivate={activate}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] ?? document.body, { key: "j" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1] ?? document.body, { key: " " });
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("checkbox", { name: "Vælg Fiction B" })).toBeChecked();
    fireEvent.keyDown(rows[1] ?? document.body, { key: "Enter" });
    expect(activate).toHaveBeenCalledWith({ id: "b", name: "Fiction B" });
    fireEvent.keyDown(rows[1] ?? document.body, { key: "k" });
    expect(rows[0]).toHaveFocus();
  });
  it("provides labelled inputs, navigation and quick links", () => {
    const back = vi.fn();
    mount(
      <>
        <PageHeader title="Food" subtitle="Library" onBack={back} simple />
        <TextInput label="Name" />
        <NumberInput label="Grams" />
        <QuickLinkCard href="/da/library" title="Library" subtitle="3 foods" />
      </>,
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Grams")).toHaveAttribute("type", "number");
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute("href", "/da/library");
  });
});
