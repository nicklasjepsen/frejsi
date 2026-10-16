// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
function worker(existing = true) {
  const handlers = new Map<string, (event: unknown) => void>();
  const shown: unknown[] = [],
    opened: unknown[] = [],
    focused: unknown[] = [];
  const client = {
    url: "https://frejsi.example/da/now",
    navigate: (url: string) => {
      opened.push(url);
      return Promise.resolve(client);
    },
    focus: () => {
      focused.push(true);
      return Promise.resolve(client);
    },
  };
  const self = {
    location: { origin: "https://frejsi.example" },
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    registration: {
      showNotification: (...args: unknown[]) => {
        shown.push(args);
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(existing ? [client] : []),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8"), {
    self,
    URL,
  });
  async function run(type: string, fields: object) {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)?.({
      ...fields,
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
  }
  return { run, shown, opened, focused };
}
it("shows the minimal push notification", async () => {
  const w = worker();
  await w.run("push", {
    data: {
      json: () => ({
        title: "Example asks",
        body: "Example dish",
        data: { url: "/da/library/f1" },
      }),
    },
  });
  expect(w.shown).toEqual([
    [
      "Example asks",
      { body: "Example dish", data: { url: "/da/library/f1" }, icon: "/icons/icon-192.png" },
    ],
  ]);
});
it.each([true, false])(
  "click opens the library destination, reusing a window when present (%s)",
  async (existing) => {
    const w = worker(existing);
    await w.run("notificationclick", {
      notification: { data: { url: "/en/library/f1" }, close: () => undefined },
    });
    expect(w.opened).toEqual(["https://frejsi.example/en/library/f1"]);
    expect(w.focused).toHaveLength(existing ? 1 : 0);
  },
);
it("ignores malformed pushes and external notification URLs", async () => {
  const w = worker();
  await w.run("push", {
    data: {
      json: () => {
        throw new Error("bad json");
      },
    },
  });
  await w.run("notificationclick", {
    notification: { data: { url: "https://external.example/" }, close: () => undefined },
  });
  expect(w.shown).toEqual([]);
  expect(w.opened).toEqual([]);
});
