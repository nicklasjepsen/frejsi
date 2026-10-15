import { describe, expect, expectTypeOf, it } from "vitest";

import type { GlucoseSourceType } from "../schemas/glucose";
import { DexcomShareSource } from "./dexcom-share/source";
import { FakeGlucoseSource } from "./fake";
import type { GlucoseSource } from "./types";

/**
 * Hard rule (CLAUDE.md): glucose sources are read-only. Frejsi never writes to a CGM or glucose
 * service, even when the credential would allow it. Two guards:
 *
 * - the interface: `GlucoseSource` exposes exactly the read operations below, checked by
 *   `pnpm typecheck` (a method added to the interface fails here until it is added to the list,
 *   which a reviewer then sees in the diff);
 * - each source: every function member of every registered source, public and private, is listed
 *   by name as a read step. A new member fails the test until it is added, which is the moment to
 *   ask what it sends to the provider.
 */
const READ_ONLY_METHODS = ["fetchSince", "probe"] as const;
type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number];

expectTypeOf<keyof GlucoseSource>().toEqualTypeOf<ReadOnlyMethod>();

/** A fetch that never answers: the sources are inspected, never used. */
const unreachable = () => Promise.reject(new TypeError("fetch failed"));

interface Registered {
  make(): GlucoseSource;
  /** Every function member the implementation has, including private helpers. */
  members: readonly string[];
}

/**
 * One entry per `GlucoseSourceType` (the poller's `ADAPTERS` picks a class by the same key) plus
 * the fake used by the seed, the CLI and tests. A source type added to the schema fails to compile
 * here until its adapter is listed.
 */
const SOURCES: Record<GlucoseSourceType | "fake", Registered> = {
  "dexcom-share": {
    make: () =>
      new DexcomShareSource({
        region: "eu",
        username: "publisher@example.invalid",
        password: "<fixture-password>",
        fetch: unreachable,
      }),
    members: [
      ...READ_ONLY_METHODS,
      "session", // the cached session id, or one login shared by concurrent fetches
      "login", // authenticate + login: two allow-listed POSTs
      "readLatest", // the allow-listed latest-values read
      "request", // the one path to the transport, which holds the allow-list
      "decode", // parses a response body
      "fetch", // the injected fetch; only the transport calls it (lint)
      "now", // the injected clock
    ],
  },
  fake: {
    make: () => new FakeGlucoseSource(),
    members: [
      ...READ_ONLY_METHODS,
      "now", // the injected clock
    ],
  },
};

/** Function-valued members of an object and its prototypes (methods and injected collaborators). */
function functionMembers(instance: object): string[] {
  const names = new Set<string>();
  for (
    let o: object | null = instance;
    o && o !== Object.prototype;
    o = Object.getPrototypeOf(o) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(o, name);
      if (typeof descriptor?.value === "function") names.add(name);
    }
  }
  return [...names].sort();
}

describe("glucose sources are read-only", () => {
  it("the interface exposes the read operations only", () => {
    const keys: Record<ReadOnlyMethod, true> = { fetchSince: true, probe: true };
    expect(Object.keys(keys).sort()).toEqual([...READ_ONLY_METHODS].sort());
  });

  it.each(Object.entries(SOURCES))(
    "%s has no function member beyond its listed read steps",
    (_name, source) => {
      const instance = source.make();
      expect(functionMembers(instance)).toEqual([...source.members].sort());
      for (const method of READ_ONLY_METHODS) expect(typeof instance[method]).toBe("function");
    },
  );

  it("no source has a member whose name says it sends data to the provider", () => {
    const writeWords =
      /^(post|put|patch|delete|remove|create|update|upload|send|write|set|invite|add|replace)/i;
    for (const source of Object.values(SOURCES)) {
      for (const member of functionMembers(source.make())) {
        expect(member, `${member} on a glucose source`).not.toMatch(writeWords);
        expect(member).not.toMatch(/subscription|contact|alert|follower/i);
      }
    }
  });
});
