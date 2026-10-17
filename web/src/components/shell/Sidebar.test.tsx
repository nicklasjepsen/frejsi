import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { isChromeless, phoneItems, shellVariant, sidebarItems } from "./nav";
import { Sidebar, type SidebarProps } from "./Sidebar";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

function mount(role: SidebarProps["space"]["role"], simpleMode = false) {
  const variant = shellVariant(role, simpleMode);
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <Sidebar
        locale="da"
        variant={variant}
        path="/now"
        user={{ name: "Jonas" }}
        space={{
          id: "s1",
          name: "Almas rum",
          role,
          subjectName: "Alma",
          ownerName: "Jonas",
          aiEnabled: false,
        }}
        spaces={[{ id: "s1", name: "Almas rum", role }]}
      />
    </I18nProvider>,
  );
  const side = screen.getByTestId("sidebar");
  return within(side)
    .getAllByRole("link")
    .map((a) => ({ label: within(a).getByTestId("label").textContent, href: a.getAttribute("href") }));
}
afterEach(() => {
  cleanup();
  navigation.push.mockClear();
});

describe("Jeg har det… in the desktop sidebar (v0.6.0 plan §5)", () => {
  it.each(["owner", "carer"] as const)("shows it for a %s, between Historik and Personer, leading to /feel", (role) => {
    const items = mount(role);
    expect(items.map((i) => i.label)).toEqual([
      "Nu",
      "Log et måltid",
      "Bibliotek",
      "Historik",
      "Jeg har det…",
      "Personer",
      "Indstillinger",
    ]);
    expect(items.find((i) => i.label === "Jeg har det…")?.href).toBe("/da/feel");
  });
  it("never shows it to a viewer", () => {
    const items = mount("viewer");
    expect(items.map((i) => i.label)).toEqual(["I dag", "Tidligere dage", "Indstillinger"]);
    expect(items.some((i) => i.href?.endsWith("/feel"))).toBe(false);
  });
  it("keeps the simpleMode sidebar at its three items: the simple Now carries the button", () => {
    expect(mount("carer", true).map((i) => i.label)).toEqual(["Nu", "Min mad"]);
  });
  it("jumps there with J from any screen, not while typing", () => {
    mount("owner");
    fireEvent.keyDown(document, { key: "j" });
    expect(navigation.push).toHaveBeenCalledWith("/da/feel");
  });
  it("stays out of the phone tabs, and the picker is a chromeless sub-screen like Min mad", () => {
    expect(phoneItems("normal").map((i) => i.href)).not.toContain("/feel");
    expect(sidebarItems("normal").map((i) => i.href)).toContain("/feel");
    expect(sidebarItems("viewer").map((i) => i.href)).not.toContain("/feel");
    expect(sidebarItems("simple").map((i) => i.href)).not.toContain("/feel");
    expect(isChromeless("/feel")).toBe(true);
    expect(isChromeless("/feel/x")).toBe(false);
  });
});
