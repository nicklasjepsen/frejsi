import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import da from "../../../messages/da";
import en from "../../../messages/en";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("SymptomDetailCard delete (#220)", () => {
  function renderCard(props: { spaceId?: string; mayDelete?: boolean; onClose?: () => void }) {
    return render(
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomDetailCard
          locale="da"
          timeZone={zone}
          symptom={symptom}
          onClose={props.onClose ?? vi.fn()}
          {...(props.spaceId ? { spaceId: props.spaceId } : {})}
          {...(props.mayDelete !== undefined ? { mayDelete: props.mayDelete } : {})}
        />
      </NextIntlClientProvider>,
    );
  }

  it("offers no delete unless the screen says the member may (simpleMode, viewer)", () => {
    renderCard({});
    expect(screen.queryByRole("button", { name: "Slet" })).toBeNull();
    cleanup();
    renderCard({ spaceId: "sp1", mayDelete: false });
    expect(screen.queryByRole("button", { name: "Slet" })).toBeNull();
    cleanup();
    renderCard({ mayDelete: true });
    expect(screen.queryByRole("button", { name: "Slet" })).toBeNull();
  });

  it("drops the question when the card moves to another symptom", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const card = (shown: typeof symptom) => (
      <NextIntlClientProvider locale="da" messages={da}>
        <SymptomDetailCard
          locale="da"
          timeZone={zone}
          symptom={shown}
          onClose={vi.fn()}
          spaceId="sp1"
          mayDelete
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(card(symptom));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Slet" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Slet ondt i maven kl. 14:30?");
    rerender(card({ ...symptom, id: "s2", ts: "2026-10-14T13:00:00.000Z" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent("Slet ondt i maven");
    expect(within(dialog).queryByRole("button", { name: "Behold" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once in the card, and 'Behold' leaves everything as it was", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    renderCard({ spaceId: "sp1", mayDelete: true, onClose });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    expect(dialog).toHaveTextContent("Slet ondt i maven kl. 14:30?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Behold" }));
    expect(dialog).not.toHaveTextContent("Slet ondt i maven kl. 14:30?");
    expect(within(dialog).getByRole("button", { name: "Slet" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("on confirm calls the DELETE route and closes the card", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    renderCard({ spaceId: "sp1", mayDelete: true, onClose });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/spaces/sp1/symptoms/s1");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("says so when the delete fails and keeps the card open", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "internal" } }), { status: 500 }),
        ),
    );
    const onClose = vi.fn();
    renderCard({ spaceId: "sp1", mayDelete: true, onClose });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Det blev ikke slettet – prøv igen",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks in English too", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SymptomDetailCard
          locale="en"
          timeZone={zone}
          symptom={symptom}
          spaceId="sp1"
          mayDelete
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(dialog).toHaveTextContent("Delete stomach ache at 14:30?");
    expect(within(dialog).getByRole("button", { name: "Keep" })).toBeInTheDocument();
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
