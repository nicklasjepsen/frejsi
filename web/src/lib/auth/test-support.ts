// Test doubles for the auth modules: an in-memory stand-in for the Prisma delegates in `AuthDb`,
// a recording `emit`, and a virtual WebAuthn authenticator that produces real, verifiable
// registration and assertion responses with Node's crypto. Imported by *.test.ts only.
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";

import type { EventEnvelope, EventSink, EventType } from "@frejsi/shared";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import type { AuthDb, AuthTx, TransactionOptions } from "./core";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export type TableName =
  "user" | "space" | "membership" | "invite" | "passkey" | "session" | "authChallenge" | "event";

export type Tables = Record<TableName, Row[]>;

const emptyTables = (): Tables => ({
  user: [],
  space: [],
  membership: [],
  invite: [],
  passkey: [],
  session: [],
  authChallenge: [],
  event: [],
});

/** Column defaults the schema gives (plan §3), applied on create when the caller leaves them out. */
const defaults: Record<TableName, (now: Date) => Row> = {
  user: (now) => ({
    id: randomUUID(),
    avatar: null,
    simpleMode: false,
    accent: "olive",
    locale: "da",
    createdAt: now,
    lastSeen: null,
  }),
  space: (now) => ({
    id: randomUUID(),
    subjectUserId: null,
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    glucoseSource: null,
    sourceStatus: "not-configured",
    sourceFailures: 0,
    lastReadingAt: null,
    lastSeq: 0,
    aiEnabled: false,
    aiProvider: null,
    createdAt: now,
  }),
  membership: (now) => ({ createdAt: now }),
  invite: (now) => ({ forUserId: null, createdAt: now, usedAt: null, revokedAt: null }),
  passkey: (now) => ({
    id: randomUUID(),
    transports: null,
    deviceName: null,
    createdAt: now,
    lastUsedAt: null,
  }),
  session: (now) => ({ passkeyId: null, createdAt: now, lastSeenAt: now }),
  authChallenge: () => ({ id: randomUUID(), inviteToken: null, userId: null }),
  event: (now) => ({ ts: now }),
};

/** Primary and unique keys, so a duplicate insert fails the way SQL Server would. */
const uniqueKeys: Record<TableName, string[][]> = {
  user: [["id"]],
  space: [["id"]],
  membership: [["userId", "spaceId"]],
  invite: [["token"]],
  passkey: [["id"], ["credentialId"]],
  session: [["id"]],
  authChallenge: [["id"]],
  event: [["spaceId", "seq"]],
};

interface Relation {
  table: TableName;
  /** Column on this row that holds the key. */
  from: string;
  /** Column on the related row it points to. */
  to: string;
  many: boolean;
}

const relations: Partial<Record<TableName, Record<string, Relation>>> = {
  invite: {
    space: { table: "space", from: "spaceId", to: "id", many: false },
    creator: { table: "user", from: "createdBy", to: "id", many: false },
    forUser: { table: "user", from: "forUserId", to: "id", many: false },
  },
  session: {
    user: { table: "user", from: "userId", to: "id", many: false },
    passkey: { table: "passkey", from: "passkeyId", to: "id", many: false },
  },
  passkey: {
    user: { table: "user", from: "userId", to: "id", many: false },
    sessions: { table: "session", from: "id", to: "passkeyId", many: true },
  },
  user: {
    memberships: { table: "membership", from: "id", to: "userId", many: true },
    passkeys: { table: "passkey", from: "id", to: "userId", many: true },
    sessions: { table: "session", from: "id", to: "userId", many: true },
  },
  membership: {
    user: { table: "user", from: "userId", to: "id", many: false },
    space: { table: "space", from: "spaceId", to: "id", many: false },
  },
  space: {
    memberships: { table: "membership", from: "id", to: "spaceId", many: true },
    invites: { table: "invite", from: "id", to: "spaceId", many: true },
  },
};

function isOperator(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number);
  const y = b instanceof Date ? b.getTime() : (b as number);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    // Compound unique keys arrive as `{ userId_spaceId: { userId, spaceId } }`.
    if (key.includes("_") && isOperator(expected) && !("lt" in expected)) {
      return matches(row, expected);
    }
    const actual = row[key];
    if (isOperator(expected)) {
      return Object.entries(expected).every(([op, value]) => {
        switch (op) {
          case "lt":
            return compare(actual, value) < 0;
          case "lte":
            return compare(actual, value) <= 0;
          case "gt":
            return compare(actual, value) > 0;
          case "gte":
            return compare(actual, value) >= 0;
          case "not":
            return !same(actual, value);
          case "in":
            return Array.isArray(value) && value.some((v) => same(actual, v));
          default:
            throw new Error(`fake db: operator ${op} is not supported`);
        }
      });
    }
    return same(actual, expected);
  });
}

export class FakeDbError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FakeDbError";
  }
}

/** One delegate call, and whether it went through a transaction client or the root client. */
export interface Operation {
  table: TableName;
  op: string;
  inTransaction: boolean;
}

/**
 * An in-memory `AuthDb`. It understands the argument shapes the auth modules use (equality and
 * lt/gt/not/in in `where`, compound keys, nested `include`), enforces the schema's unique keys,
 * and rolls a `$transaction` back when its callback throws. The client a transaction callback
 * receives is a distinct object, so a test can tell a read inside the transaction from one that
 * slipped out to the root client.
 */
export class FakeAuthDb {
  tables: Tables = emptyTables();
  /** Set to make the next write to this table throw, to prove a transaction rolls back. */
  failNextWrite: TableName | null = null;
  /** Runs right before every write; a test uses it to mutate state as a racing request would. */
  beforeWrite: ((table: TableName) => void) | null = null;
  /** Runs when a transaction starts, before its callback; a throw here is the transaction's. */
  onTransaction: (() => void) | null = null;
  /** The options every `$transaction` was called with, in order. */
  readonly transactions: (TransactionOptions | undefined)[] = [];
  /** Every delegate call, in order. */
  readonly operations: Operation[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** The object to hand to code that expects `AuthDb` (or `AuthTx`). */
  get db(): AuthDb {
    const delegates = this.delegates(false) as Record<string, unknown>;
    delegates.$transaction = async <T>(
      fn: (tx: AuthTx) => Promise<T>,
      options?: TransactionOptions,
    ): Promise<T> => {
      this.transactions.push(options);
      // The hook models what another request did or does to this transaction: a commit that
      // must survive this one's rollback, or the deadlock that kills it.
      this.onTransaction?.();
      const snapshot = structuredClone(this.tables);
      try {
        return await fn(this.delegates(true));
      } catch (error) {
        this.tables = snapshot;
        throw error;
      }
    };
    return delegates as unknown as AuthDb;
  }

  private delegates(inTransaction: boolean): AuthTx {
    const out: Record<string, unknown> = {};
    for (const table of Object.keys(this.tables) as TableName[]) {
      out[table] = this.delegate(table, inTransaction);
    }
    return out as unknown as AuthTx;
  }

  rows(table: TableName): Row[] {
    return this.tables[table];
  }

  private include(table: TableName, row: Row, include: Record<string, unknown> | undefined): Row {
    if (!include) return { ...row };
    const out: Row = { ...row };
    for (const [name, spec] of Object.entries(include)) {
      if (!spec) continue;
      const relation = relations[table]?.[name];
      if (!relation) throw new Error(`fake db: relation ${table}.${name} is not modelled`);
      const nested = isOperator(spec) && isOperator(spec.include) ? spec.include : undefined;
      const related = this.tables[relation.table].filter((r) =>
        same(r[relation.to], row[relation.from]),
      );
      out[name] = relation.many
        ? related.map((r) => this.include(relation.table, r, nested))
        : related[0]
          ? this.include(relation.table, related[0], nested)
          : null;
    }
    return out;
  }

  private checkUnique(table: TableName, row: Row, except?: Row): void {
    for (const key of uniqueKeys[table]) {
      const clash = this.tables[table].find(
        (r) => r !== except && key.every((k) => same(r[k], row[k])),
      );
      if (clash) {
        throw new FakeDbError("P2002", `Unique constraint failed on ${table}(${key.join(",")})`);
      }
    }
  }

  private failIfAsked(table: TableName): void {
    this.beforeWrite?.(table);
    if (this.failNextWrite === table) {
      this.failNextWrite = null;
      throw new FakeDbError("P9999", `fake db: injected failure on ${table}`);
    }
  }

  private delegate(table: TableName, inTransaction: boolean) {
    const rows = () => this.tables[table];
    const record = (op: string) => this.operations.push({ table, op, inTransaction });
    const find = (args: { where?: Where; include?: Record<string, unknown> } = {}) =>
      rows()
        .filter((r) => matches(r, args.where))
        .map((r) => this.include(table, r, args.include));
    const strip = (data: Row, base?: Row): Row => {
      // Of the nested writes only `increment` is modelled: `emit()` allocates `Space.lastSeq` with it.
      const out: Row = {};
      for (const [k, v] of Object.entries(data)) {
        if (isOperator(v) && "increment" in v && base) {
          // A seeded row may lack the column; the schema's default is 0.
          out[k] = ((base[k] as number | undefined) ?? 0) + (v.increment as number);
        } else if (isOperator(v) && ("increment" in v || "set" in v || "connect" in v)) {
          throw new Error(`fake db: nested write ${table}.${k} is not supported`);
        } else {
          out[k] = v;
        }
      }
      return out;
    };
    const select = (row: Row, keys: Record<string, unknown> | undefined): Row =>
      keys ? Object.fromEntries(Object.keys(keys).map((k) => [k, row[k]])) : row;
    return {
      create: (args: { data: Row; include?: Record<string, unknown> }) => {
        record("create");
        this.failIfAsked(table);
        const row = { ...defaults[table](this.now()), ...strip(args.data) };
        this.checkUnique(table, row);
        rows().push(row);
        return Promise.resolve(this.include(table, row, args.include));
      },
      findUnique: (args: { where: Where; include?: Record<string, unknown> }) => {
        record("findUnique");
        return Promise.resolve(find(args)[0] ?? null);
      },
      findFirst: (args: { where?: Where; include?: Record<string, unknown> } = {}) => {
        record("findFirst");
        return Promise.resolve(find(args)[0] ?? null);
      },
      findMany: (args: { where?: Where; include?: Record<string, unknown> } = {}) => {
        record("findMany");
        return Promise.resolve(find(args));
      },
      count: (args: { where?: Where } = {}) => {
        record("count");
        return Promise.resolve(rows().filter((r) => matches(r, args.where)).length);
      },
      update: (args: {
        where: Where;
        data: Row;
        include?: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        record("update");
        this.failIfAsked(table);
        const row = rows().find((r) => matches(r, args.where));
        if (!row) {
          return Promise.reject(new FakeDbError("P2025", `Record to update not found in ${table}`));
        }
        const next = { ...row, ...strip(args.data, row) };
        this.checkUnique(table, next, row);
        Object.assign(row, next);
        return Promise.resolve(select(this.include(table, row, args.include), args.select));
      },
      updateMany: (args: { where: Where; data: Row }) => {
        record("updateMany");
        this.failIfAsked(table);
        const hits = rows().filter((r) => matches(r, args.where));
        for (const row of hits) Object.assign(row, strip(args.data));
        return Promise.resolve({ count: hits.length });
      },
      delete: (args: { where: Where }) => {
        record("delete");
        this.failIfAsked(table);
        const index = rows().findIndex((r) => matches(r, args.where));
        if (index < 0) {
          return Promise.reject(new FakeDbError("P2025", `Record to delete not found in ${table}`));
        }
        const [row] = rows().splice(index, 1);
        return Promise.resolve(row);
      },
      deleteMany: (args: { where?: Where } = {}) => {
        record("deleteMany");
        this.failIfAsked(table);
        const before = rows().length;
        this.tables[table] = rows().filter((r) => !matches(r, args.where));
        return Promise.resolve({ count: before - this.tables[table].length });
      },
    };
  }
}

export interface RecordedEvent {
  spaceId: string;
  type: EventType;
  payload: unknown;
}

/**
 * An `EventSink` that records what `transact()` publishes after each commit, in order, as
 * `{ spaceId, type, payload }`. The rows themselves are in the fake's `event` table.
 */
export function recordingSink(): {
  sink: EventSink;
  events: RecordedEvent[];
  published: { group: string; envelope: EventEnvelope }[];
} {
  const events: RecordedEvent[] = [];
  const published: { group: string; envelope: EventEnvelope }[] = [];
  const sink: EventSink = {
    publish: (group, envelope) => {
      published.push({ group, envelope });
      events.push({ spaceId: envelope.spaceId, type: envelope.type, payload: envelope.payload });
      return Promise.resolve();
    },
  };
  return { sink, events, published };
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();

const FLAG_UP = 1 << 0;
const FLAG_UV = 1 << 2;
const FLAG_AT = 1 << 6;

interface StoredCredential {
  privateKeyPem: string;
  counter: number;
  userHandle: string;
}

export interface AssertOptions {
  /** Which of this authenticator's credentials signs; the first one when omitted. */
  credentialId?: string;
  /** The counter to report; a value at or below the last one is a cloned-authenticator replay. */
  counter?: number;
  /** The origin written into clientDataJSON; the real browser writes the page's origin. */
  origin?: string;
  userVerified?: boolean;
}

/**
 * A platform authenticator for tests: ES256 keys, `none` attestation, the counter incremented on
 * every assertion unless a test says otherwise. Everything it returns is what
 * `@simplewebauthn/browser` would hand back after `navigator.credentials.create/get`.
 */
export class VirtualAuthenticator {
  readonly credentials = new Map<string, StoredCredential>();

  constructor(
    readonly rpId: string,
    readonly origin: string,
  ) {}

  private authData(flags: number, counter: number, attested?: Uint8Array): Uint8Array {
    const head = Buffer.alloc(37);
    sha256(this.rpId).copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(counter, 33);
    return attested ? Buffer.concat([head, attested]) : head;
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    {
      origin = this.origin,
      userVerified = true,
    }: Pick<AssertOptions, "origin" | "userVerified"> = {},
  ): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" });
    const credentialId = randomBytes(16);
    const coseKey = isoCBOR.encode(
      new Map<number, unknown>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? "", "base64url")],
        [-3, Buffer.from(jwk.y ?? "", "base64url")],
      ]) as never,
    );
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), credIdLen, credentialId, coseKey]);
    const flags = FLAG_UP | FLAG_AT | (userVerified ? FLAG_UV : 0);
    const authData = this.authData(flags, 0, attested);
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]) as never,
    );
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: options.challenge,
        origin,
        crossOrigin: false,
      }),
    );
    const id = b64(credentialId);
    this.credentials.set(id, {
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      counter: 0,
      userHandle: options.user.id,
    });
    return {
      id,
      rawId: id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
    };
  }

  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    opts: AssertOptions = {},
  ): AuthenticationResponseJSON {
    const id = opts.credentialId ?? [...this.credentials.keys()][0];
    const stored = id ? this.credentials.get(id) : undefined;
    if (!id || !stored) throw new Error("virtual authenticator: no such credential");
    const counter = opts.counter ?? stored.counter + 1;
    stored.counter = Math.max(stored.counter, counter);
    const flags = FLAG_UP | ((opts.userVerified ?? true) ? FLAG_UV : 0);
    const authData = this.authData(flags, counter);
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: options.challenge,
        origin: opts.origin ?? this.origin,
        crossOrigin: false,
      }),
    );
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), {
      key: createPrivateKey(stored.privateKeyPem),
      dsaEncoding: "der",
    });
    return {
      id,
      rawId: id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: stored.userHandle,
      },
    };
  }
}
