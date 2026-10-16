import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AiUsage } from "@frejsi/shared/schemas/ai";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { AiSection } from "./AiSection";

const usage: AiUsage = {
  enabled: true,
  provider: "anthropic",
  providers: [
    {
      id: "anthropic",
      configured: true,
      capabilities: { complete: true, vision: true, embed: false },
    },
    {
      id: "azure-openai",
      configured: false,
      capabilities: { complete: false, vision: false, embed: false },
    },
    {
      id: "ollama",
      configured: true,
      capabilities: { complete: true, vision: false, embed: true },
    },
  ],
  callsToday: 7,
  dailyCap: 50,
  embedCallsToday: 2,
  embedDailyCap: 500,
};
function mount(owner = true, configured = usage) {
  const change = vi.fn();
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <AiSection
        spaceId="s1"
        subject="Example Child"
        enabled={configured.enabled}
        provider={configured.provider}
        usage={configured}
        owner={owner}
        busy={false}
        onChange={change}
      />
    </I18nProvider>,
  );
  return change;
}
afterEach(cleanup);
it("renders the phone row, provider capabilities, three desktop notices and daily usage", () => {
  mount();
  expect(screen.getByTestId("ai-row")).toHaveTextContent(
    "Søgning, stemme, billeder og observationer · Anthropic",
  );
  expect(screen.getByText("Højst 50 kald om dagen")).toBeInTheDocument();
  expect(screen.getByText(/i dette rum. I dag: 7/)).toBeInTheDocument();
  expect(screen.getAllByText("søgning uden AI").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /Azure OpenAI/ })[0]).toBeDisabled();
  expect(screen.getAllByRole("button", { name: /Anthropic/ })[0]).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("only owners can change AI and the provider", () => {
  const change = mount(false);
  expect(screen.getByRole("switch", { name: "AI-hjælp" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "AI-hjælp" }));
  expect(change).not.toHaveBeenCalled();
});
it("turns off with an explicit patch and uses the off suffix", () => {
  const change = mount();
  fireEvent.click(screen.getByRole("switch", { name: "AI-hjælp" }));
  expect(change).toHaveBeenCalledWith({ aiEnabled: false });
  cleanup();
  mount(true, { ...usage, enabled: false });
  expect(screen.getByTestId("ai-row")).toHaveTextContent("· fra");
});
it("cannot enable a deployment without providers", () => {
  mount(true, {
    ...usage,
    enabled: false,
    provider: undefined,
    providers: usage.providers.map((p) => ({ ...p, configured: false })),
  });
  expect(screen.getByRole("switch", { name: "AI-hjælp" })).toBeDisabled();
  expect(screen.getByText("AI er ikke sat op her endnu.")).toBeInTheDocument();
});
it("opens the phone picker and chooses a configured provider", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  const change = mount();
  fireEvent.click(screen.getByRole("button", { name: "Udbyder" }));
  const dialog = screen.getByRole("dialog", { name: "Udbyder" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Ollama (lokalt)" }));
  expect(change).toHaveBeenCalledWith({ aiProvider: "ollama" });
  expect(dialog).not.toHaveAttribute("open");
});
it("shows push only while AI is enabled with a runtime public key", () => {
  mount(true, { ...usage, pushPublicKey: "AQID" });
  expect(screen.getByTestId("push-row")).toBeInTheDocument();
  cleanup();
  mount(true, { ...usage, enabled: false, pushPublicKey: "AQID" });
  expect(screen.queryByTestId("push-row")).toBeNull();
});
