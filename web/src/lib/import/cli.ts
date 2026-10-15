// The pure parts of `pnpm --filter ./web import` (scripts/import-glucose.ts, #156): the arguments
// and the owner check. Nothing here reads the file, the environment or the database.
import { HttpError, SessionContext } from "@frejsi/shared";

export interface ImportArgs {
  file: string;
  spaceId: string;
  userId: string;
  createMeals: boolean;
}

export const USAGE = "usage: import <file> --space <spaceId> --user <userId> [--no-meals]";

/** The command line after the script name; throws `HttpError(400, "validation")` on anything else. */
export function parseArgs(argv: readonly string[]): ImportArgs {
  const positional: string[] = [];
  const named: Record<string, string> = {};
  let createMeals = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") continue;
    if (arg === "--no-meals") createMeals = false;
    else if (arg === "--space" || arg === "--user") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw usageError();
      named[arg] = value;
      i += 1;
    } else if (arg.startsWith("--")) throw usageError();
    else positional.push(arg);
  }
  const [file, ...extra] = positional;
  const spaceId = named["--space"];
  const userId = named["--user"];
  if (!file || extra.length > 0 || !spaceId || !userId) throw usageError();
  return { file, spaceId, userId, createMeals };
}

const usageError = () => new HttpError(400, "validation", USAGE);

/** The user's row as the script reads it, shaped like the session's user with memberships. */
export interface CliUser {
  id: string;
  name: string;
  simpleMode: boolean;
  accent: string;
  locale: string;
  memberships: { spaceId: string; role: string }[];
}

/** The session the route would build for this user; refuses unless they own the space. */
export function requireOwner(user: CliUser | null, spaceId: string): SessionContext {
  if (!user) throw new HttpError(404, "not-found");
  if (!user.memberships.some((m) => m.spaceId === spaceId && m.role === "owner")) {
    throw new HttpError(403, "forbidden");
  }
  return SessionContext.parse({
    userId: user.id,
    name: user.name,
    simpleMode: user.simpleMode,
    accent: user.accent,
    locale: user.locale,
    memberships: user.memberships.map((m) => ({ spaceId: m.spaceId, role: m.role })),
  });
}
