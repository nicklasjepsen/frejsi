import "@testing-library/jest-dom/vitest";

import type { DayMealView } from "@frejsi/shared/schemas/meal";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import da from "../../../messages/da";
import en from "../../../messages/en";

import { DayList, DayTotal, formatAskList, formatDayDate, MealCard } from "./index";

const ZONE = "Europe/Copenhagen";
const mount = (children: ReactNode, locale: "da" | "en" = "da") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
      {children}
    </NextIntlClientProvider>,
  );
afterEach(cleanup);

const lunch: DayMealView = {
  id: "m3",
  ts: "2026-10-14T10:10:00.000Z",
  title: "Rugbrød med ost og et æble",
  slot: "lunch",
  totalCarbs: 50,
  byUser: { id: "u-jonas", name: "Jonas" },
  items: [
    { name: "Rugbrød med ost", carbs: 36 },
    { name: "Æble", carbs: 14 },
  ],
  photo: {
    thumbUrl: "https://photos.example.invalid/m3/thumb.jpg",
    originalUrl: "https://photos.example.invalid/m3/original.jpg",
  },
};
const apple: DayMealView = {
  ...lunch,
  id: "m2",
  ts: "2026-10-14T07:50:00.000Z",
  title: "Æble",
  slot: "breakfast",
  totalCarbs: 14,
  byUser: { id: "u-alma", name: "Alma" },
  items: [{ name: "Æble", carbs: 14 }],
};
delete (apple as Partial<DayMealView>).photo;

describe("MealCard (design README MealCard)", () => {
  it("draws the timeline row: time column, 48 px thumbnail, serif title, carbs and author", () => {
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="row" />);
    const card = screen.getByTestId("meal-card");
    expect(card).toHaveAttribute("data-variant", "row");
    expect(within(card).getByText("12:10")).toHaveAttribute("datetime", lunch.ts);
    const photo = within(card).getByRole("img", { name: lunch.title });
    expect(photo).toHaveAttribute("src", lunch.photo?.thumbUrl);
    expect(photo).toHaveStyle({ width: "48px", height: "48px" });
    expect(within(card).getByText("Rugbrød med ost og et æble")).toBeVisible();
    expect(within(card).getByText("50 g kulhydrat · Jonas")).toBeVisible();
  });

  it("draws the phone card with a 64 px photo and the time in its meta line", () => {
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="card" />);
    const card = screen.getByTestId("meal-card");
    expect(within(card).getByRole("img")).toHaveStyle({ width: "64px" });
    expect(within(card).getByText("12:10 · 50 g kulhydrat · Jonas")).toBeVisible();
  });

  it("draws the simple variant with 'Du spiste kl.' above the title, and the placeholder without a photo", () => {
    mount(<MealCard meal={apple} timeZone={ZONE} variant="simple" />);
    const card = screen.getByTestId("meal-card");
    const lines = within(card).getAllByText(/Du spiste kl\. 09:50|^Æble$/);
    expect(lines.map((l) => l.textContent)).toEqual(["Du spiste kl. 09:50", "Æble"]);
    expect(within(card).getByRole("img", { name: "Æble" }).tagName).toBe("SPAN");
  });

  it("speaks English too", () => {
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="card" />, "en");
    expect(screen.getByText("12:10 · 50 g carbs · Jonas")).toBeVisible();
  });

  it.each(["row", "card"] as const)(
    "%s: the whole card links to the meal and an owner's or carer's carries a trailing 'Ret' to ?edit=1",
    (variant) => {
      for (const role of ["owner", "carer"] as const) {
        cleanup();
        mount(<MealCard meal={lunch} timeZone={ZONE} variant={variant} locale="da" role={role} />);
        const card = screen.getByTestId("meal-card");
        const link = within(card).getByRole("link", { name: /Rugbrød med ost og et æble/ });
        expect(link).toHaveAttribute("href", "/da/meal/m3");
        expect(link).toHaveTextContent("12:10");
        expect(within(link).getByRole("img", { name: lunch.title })).toBeVisible();
        const edit = within(card).getByRole("link", { name: "Ret måltidet kl. 12:10" });
        expect(edit).toHaveAttribute("href", "/da/meal/m3?edit=1");
        expect(edit).toHaveTextContent("Ret");
        expect(edit).toHaveAttribute("data-testid", "meal-edit");
        // The link and the control are siblings: nothing interactive is nested.
        expect(link.contains(edit)).toBe(false);
      }
    },
  );

  it("gives a viewer's row the link but no 'Ret', and a row without a locale neither", () => {
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="row" locale="da" role="viewer" />);
    expect(screen.getByRole("link", { name: /Rugbrød/ })).toHaveAttribute("href", "/da/meal/m3");
    expect(screen.queryByTestId("meal-edit")).toBeNull();
    cleanup();
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="row" role="owner" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("meal-edit")).toBeNull();
  });

  it("links the simple card to the meal with no edit affordance, whatever the role", () => {
    mount(<MealCard meal={apple} timeZone={ZONE} variant="simple" locale="da" role="owner" />);
    const link = screen.getByRole("link", { name: /Du spiste kl\. 09:50/ });
    expect(link).toHaveAttribute("href", "/da/meal/m2");
    expect(screen.queryByTestId("meal-edit")).toBeNull();
    expect(screen.queryByText("Ret")).toBeNull();
  });

  it("says 'Edit the meal at 12:10' in English", () => {
    mount(<MealCard meal={lunch} timeZone={ZONE} variant="row" locale="en" role="owner" />, "en");
    const edit = screen.getByRole("link", { name: "Edit the meal at 12:10" });
    expect(edit).toHaveAttribute("href", "/en/meal/m3?edit=1");
    expect(edit).toHaveTextContent("Edit");
  });
});

describe("DayList and DayTotal", () => {
  it("lists the meals as rows in the order given, and the empty day in words", () => {
    mount(<DayList meals={[lunch, apple]} timeZone={ZONE} />);
    const rows = within(screen.getByTestId("day-list")).getAllByTestId("meal-card");
    expect(rows.map((r) => r.getAttribute("data-variant"))).toEqual(["row", "row"]);
    expect(rows[0]).toHaveTextContent("12:10");
    expect(rows[1]).toHaveTextContent("09:50");
    cleanup();
    mount(<DayList meals={[]} timeZone={ZONE} />);
    expect(screen.getByText("Ingen måltider i dag endnu")).toBeVisible();
  });

  it("passes the locale and the role to every row, so a carer's list links and edits", () => {
    mount(<DayList meals={[lunch, apple]} timeZone={ZONE} locale="da" role="carer" />);
    const list = within(screen.getByTestId("day-list"));
    expect(
      list.getAllByRole("link", { name: /Ret måltidet/ }).map((a) => a.getAttribute("href")),
    ).toEqual(["/da/meal/m3?edit=1", "/da/meal/m2?edit=1"]);
    cleanup();
    mount(<DayList meals={[lunch]} timeZone={ZONE} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("draws the total at 72 px with its words", () => {
    mount(<DayTotal carbs={102} suffix="g kulhydrat indtil nu" />);
    expect(screen.getByTestId("day-total")).toHaveTextContent("102g kulhydrat indtil nu");
  });

  it("formats the day's date and whom to ask", () => {
    expect(formatDayDate("2026-10-14", "da")).toBe("onsdag 14. oktober");
    expect(formatDayDate("2026-10-14", "en")).toBe("Wednesday 14 October");
    expect(formatAskList(["Jonas", "Mette"], "da")).toBe("Jonas eller Mette");
    expect(formatAskList(["Jonas"], "en")).toBe("Jonas");
  });
});
