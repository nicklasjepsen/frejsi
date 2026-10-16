import "@testing-library/jest-dom/vitest";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { AppShell, type AppShellProps } from "./AppShell";

const navigation = vi.hoisted(() => ({ pathname: "/da/now", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("./actions", () => ({ switchSpace: vi.fn() }));

const base: AppShellProps = {
  locale: "da",
  user: { name: "Jonas", accent: "olive", simpleMode: false },
  space: { id: "s1", name: "Almas rum", role: "owner", subjectName: "Alma", ownerName: "Jonas" },
  spaces: [
    { id: "s1", name: "Almas rum", role: "owner" },
    { id: "s2", name: "Birthes rum", role: "carer" },
  ],
};

function mount(props: Partial<AppShellProps> = {}, locale: AppLocale = "da", children?: ReactNode) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <AppShell {...base} {...props} locale={locale}>
        {children ?? <p>page</p>}
      </AppShell>
    </I18nProvider>,
  );
}

const tabs = () => screen.getByTestId("phone-tabs");
const sidebar = () => screen.getByTestId("sidebar");
const labels = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("link")
    .map((a) => a.textContent);

beforeEach(() => {
  navigation.pathname = "/da/now";
  navigation.push.mockClear();
});
afterEach(cleanup);

describe("AppShell · normal mode (Main, Nu-Desktop)", () => {
  it("renders the five phone tabs Nu, Måltid, Mad, Historik, Mere", () => {
    mount();
    expect(labels(tabs())).toEqual(["Nu", "Måltid", "Mad", "Historik", "Mere"]);
    expect(within(tabs()).getByRole("link", { name: "Nu" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders the sidebar with the wordmark, the space switcher card and the six items with their shortcut hints", () => {
    mount();
    const side = sidebar();
    expect(within(side).getByText("Frejsi")).toBeInTheDocument();
    const summary = within(side).getByText("Skift rum").closest("summary");
    expect(summary).not.toBeNull();
    expect(within(summary ?? side).getByText("Almas rum")).toBeInTheDocument();
    const items = within(side).getAllByRole("link");
    expect(items.map((a) => within(a).getByTestId("label").textContent)).toEqual([
      "Nu",
      "Log et måltid",
      "Bibliotek",
      "Historik",
      "Personer",
      "Indstillinger",
    ]);
    expect(items.map((a) => within(a).getByRole("presentation").textContent)).toEqual([
      "N",
      "M",
      "B",
      "H",
      "P",
      ",",
    ]);
    const footerName = within(side).getByText("Jonas");
    expect(footerName.parentElement).toHaveTextContent("JonasEjer");
  });

  it("opens Log et måltid and the library from Måltid and Mad, and History with phone day and desktop week defaults", () => {
    mount();
    const hrefs = within(tabs())
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/da/now", "/da/log", "/da/library", "/da/history", "/da/settings"]);
    const sideHrefs = within(sidebar())
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(sideHrefs).toEqual([
      "/da/now",
      "/da/log",
      "/da/library",
      "/da/history/week",
      "/da/people",
      "/da/settings",
    ]);
  });

  it("marks the current item from the pathname, locale stripped", () => {
    navigation.pathname = "/en/library";
    mount({}, "en");
    expect(within(tabs()).getByRole("link", { name: "Food" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(sidebar()).getByRole("link", { name: /Library/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs()).getByRole("link", { name: "Now" })).not.toHaveAttribute("aria-current");
  });

  it.each(["/en/history", "/en/history/week"])("keeps History active on %s", (path) => {
    navigation.pathname = path;
    mount({}, "en");
    for (const nav of [tabs(), sidebar()]) {
      expect(within(nav).getByRole("link", { name: /History/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });

  it("opens Log et måltid with M and the library with B from any screen", () => {
    navigation.pathname = "/da/people";
    mount();
    fireEvent.keyDown(document, { key: "m" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/log");
    fireEvent.keyDown(document, { key: "B" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/library");
  });

  it("navigates with the keyboard shortcuts N M B H P , unless typing in a field", () => {
    mount();
    fireEvent.keyDown(document, { key: "h" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/history/week");
    fireEvent.keyDown(document, { key: "," });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/settings");
    fireEvent.keyDown(document, { key: "p", ctrlKey: true });
    expect(navigation.push).toHaveBeenCalledTimes(2);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "n" });
    expect(navigation.push).toHaveBeenCalledTimes(2);
  });

  it("shows the phone header with the subject's avatar and name and a slot for the page's status", () => {
    mount();
    const header = screen.getByTestId("phone-header");
    expect(within(header).getByText("Alma")).toBeInTheDocument();
    expect(within(header).getByTestId("shell-header-end")).toBeInTheDocument();
  });

  it("puts the user's accent on the shell so the accent variables switch", () => {
    mount({ user: { ...base.user, accent: "plum" } });
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-accent", "plum");
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-variant", "normal");
  });

  it("lists the memberships under Skift rum and submits the chosen one", () => {
    mount();
    const [list] = screen.getAllByRole("list", { name: "Dine rum" });
    expect(list).toBeDefined();
    const options = within(list ?? document.body).getAllByRole("button");
    expect(options.map((o) => within(o).getByText(/rum$/).textContent)).toEqual([
      "Almas rum",
      "Birthes rum",
    ]);
    expect(options.map((o) => within(o).getByText(/^(Ejer|Hjælper)$/).textContent)).toEqual([
      "Ejer",
      "Hjælper",
    ]);
    expect(options[0]).toHaveAttribute("aria-current", "true");
    expect(options[1]).toHaveAttribute("value", "s2");
    expect(options[1]).toHaveAttribute("name", "spaceId");
  });
});

describe("AppShell · module boundaries", () => {
  it("client modules export components only: a function from a 'use client' file cannot be called on the server", () => {
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      if (!/^"use client";/m.test(source)) continue;
      const exports = [...source.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(
        (m) => m[1],
      );
      for (const name of exports)
        expect(name, `${file} exports ${name ?? ""}`).toMatch(/^[A-Z][a-z]/);
    }
  });
});

describe("AppShell · simpleMode (Nu-Simpel, Nu-Simpel-Desktop)", () => {
  const simple: Partial<AppShellProps> = {
    user: { name: "Alma", accent: "plum", simpleMode: true },
    space: { ...base.space, role: "carer", aiEnabled: true },
  };

  it("renders the three phone tabs Nu, Min mad, Spørg; Min mad opens the picker and Spørg the photo question", () => {
    mount(simple);
    expect(labels(tabs())).toEqual(["Nu", "Min mad", "Spørg"]);
    expect(
      within(tabs())
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/da/now", "/da/eat", "/da/ask"]);
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-variant", "simple");
  });

  it("renders the sidebar headed by the avatar and the person's name, no wordmark, no switcher, and the footer", () => {
    mount(simple);
    const side = sidebar();
    expect(within(side).queryByText("Frejsi")).toBeNull();
    expect(within(side).queryByText("Skift rum")).toBeNull();
    expect(within(side).getByRole("heading", { name: "Alma" })).toBeInTheDocument();
    expect(
      within(side)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Nu", "Min mad", "Spørg en voksen"]);
    expect(within(side).getByText("Simpel visning · slået til af Jonas")).toBeInTheDocument();
    expect(within(side).queryByRole("presentation")).toBeNull();
  });

  it("draws the picker without the phone header and tab bar, keeping the desktop sidebar", () => {
    navigation.pathname = "/da/eat";
    mount(simple);
    expect(screen.queryByTestId("phone-tabs")).toBeNull();
    expect(screen.queryByTestId("phone-header")).toBeNull();
    expect(within(sidebar()).getByRole("link", { name: /Min mad/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("greets the person by name on the phone", () => {
    mount(simple);
    expect(within(screen.getByTestId("phone-header")).getByText("Hej Alma")).toBeInTheDocument();
  });

  it("has no keyboard shortcuts to settings: the child cannot reach them", () => {
    mount(simple);
    fireEvent.keyDown(document, { key: "," });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("AppShell · viewer (Historik-Viewer)", () => {
  const viewer: Partial<AppShellProps> = {
    user: { name: "Lærke", accent: "sea", simpleMode: false },
    space: { ...base.space, role: "viewer" },
  };

  it("renders the viewer tabs I dag, Tidligere dage, Mere and the header pill Du ser med", () => {
    mount(viewer);
    expect(labels(tabs())).toEqual(["I dag", "Tidligere dage", "Mere"]);
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-variant", "viewer");
    expect(within(screen.getByTestId("phone-header")).getByText("Du ser med")).toBeInTheDocument();
    expect(
      within(tabs())
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/da/today", "/da/history", "/da/settings"]);
  });

  it("is the viewer even when simpleMode is on: no glucose shell for a viewer", () => {
    mount({ ...viewer, user: { name: "Lærke", accent: "sea", simpleMode: true } });
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-variant", "viewer");
  });

  it("never mounts GlucoseValue: the shell has no glucose component and renders no value", () => {
    const { container } = mount(viewer);
    expect(container.querySelector("[data-glucose]")).toBeNull();
    expect(container.querySelector("svg[role=img], [aria-label^=Top]")).toBeNull();
    expect(container.textContent).not.toMatch(/mmol|mg\/dL/);
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/components\/glucose|GlucoseValue/);
    }
  });
});

it("hides the simple ask navigation while AI is off", () => {
  mount({ user: { ...base.user, simpleMode: true }, space: { ...base.space, aiEnabled: false } });
  expect(labels(tabs())).toEqual(["Nu", "Min mad"]);
  expect(
    within(sidebar()).queryByRole("link", { name: "Spørg en voksen" }),
  ).not.toBeInTheDocument();
});
