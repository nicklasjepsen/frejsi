export interface CliArgs {
  once: true;
  spaceId?: string;
}

/** `pnpm --filter ./poller poll --once [--space <id>]`; anything else is an error, not a guess. */
export function parseCliArgs(argv: string[]): CliArgs {
  let once = false;
  let spaceId: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--once") {
      once = true;
    } else if (arg === "--space") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("--space needs a space id");
      spaceId = next;
      i += 1;
    } else if (arg.startsWith("--space=")) {
      spaceId = arg.slice("--space=".length);
      if (!spaceId) throw new Error("--space needs a space id");
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!once) throw new Error("only --once is supported here; the timer runs in the Function App");
  return spaceId === undefined ? { once: true } : { once: true, spaceId };
}
