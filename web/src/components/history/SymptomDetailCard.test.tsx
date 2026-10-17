import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import da from "../../../messages/da";

import { SymptomDetailCard } from "./SymptomDetailCard";
import { SymptomRow } from "./SymptomRow";

const symptom = {
  id: "s1",
  kind: "stomach-ache",
  ts: "2026-10-14T12:30:00.000Z",
  severity: "medium" as const,
  note: "Efter fodbold",
  byUserId: "u1",
  byName: "Jonas",
};
const zone = "Europe/Copenhagen";

afterEach(cleanup);

describe("SymptomDetailCard (v0.6.0 plan §5)", () => {
  it("shows kind, severity, note, who logged it and the readings with their times, and closes", () => {
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomDetailCard
          locale="da"
          timeZone={zone}
          symptom={symptom}
          readings={[
            { ts: "2026-10-14T12:10:00.000Z", text: "6,2 mmol/L" },
            { ts: "2026-10-14T12:45:00.000Z", text: "5,1 mmol/L" },
          ]}
          onClose={onClose}
        />
      </NextIntlClientProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Ondt i maven kl. 14:30" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("Ondt i maven kl. 14:30");
    expect(dialog).toHaveTextContent("En del");
    expect(dialog).toHaveTextContent("Efter fodbold");
    expect(dialog).toHaveTextContent("Logget af Jonas");
    const readings = within(dialog).getByRole("list", { name: "Tal omkring" });
    expect(
      within(readings)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["14:10 · 6,2 mmol/L", "14:45 · 5,1 mmol/L"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Luk" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows no readings list at all when the screen passes none (a viewer's tap)", () => {
    render(
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomDetailCard locale="da" timeZone={zone} symptom={symptom} onClose={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/mmol|mg\/dL|\d,\d/);
  });

  it("names a custom kind by the space's label", () => {
    render(
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomDetailCard
          locale="da"
          timeZone={zone}
          symptom={{ ...symptom, kind: "custom:itchy" }}
          spaceKinds={[{ id: "custom:itchy", label: { da: "Kløe", en: "Itchy" } }]}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Kløe kl. 14:30" })).toBeInTheDocument();
  });
});

describe("SymptomRow", () => {
  it("is a button with the diamond marker and '{kind} kl. {time} · {name}' that opens by id", () => {
    const onOpen = vi.fn();
    render(
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomRow symptom={symptom} locale="da" timeZone={zone} onOpen={onOpen} />
      </NextIntlClientProvider>,
    );
    const row = screen.getByRole("button", { name: "Ondt i maven kl. 14:30 · Jonas" });
    expect(row).toHaveAttribute("data-testid", "symptom-row");
    expect(within(row).getByTestId("symptom-marker")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith("s1");
  });
});
