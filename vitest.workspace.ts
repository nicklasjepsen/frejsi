// Lets `vitest` at the root (and IDEs) run every package's suite with that package's own config.
// CI runs `pnpm -r test`, which uses the per-package configs directly.
export default ["shared", "web", "poller"];
