import { test as base } from "@playwright/test";

// Match the seed/server's fixed wall clock while timers, network and database remain real.
export const test = base.extend({
  page: async ({ page }, use) => {
    if (!process.env.E2E_NOW) throw new Error("E2E_NOW is required");
    await page.clock.setFixedTime(new Date(process.env.E2E_NOW));
    await use(page);
  },
});
export { expect } from "@playwright/test";
