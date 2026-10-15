import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/da.json";
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
