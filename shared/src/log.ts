/**
 * The no-PII logger (plan §9): one JSON line per call, with an allow-list of keys. A name, a
 * token or a credential passed by mistake never reaches the output.
 */
export const LOG_KEYS = ["spaceId", "userId", "count", "code", "ms", "route"] as const;
export type LogKey = (typeof LOG_KEYS)[number];

export type LogFields = Partial<Record<LogKey, string | number>> & Record<string, unknown>;
export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields, error?: unknown): void;
  /** Writes an already-formatted line; for code that formats its own. */
  raw(line: string): void;
}

function pick(fields: LogFields | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!fields) return out;
  for (const key of LOG_KEYS) {
    const value = fields[key];
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  }
  return out;
}

export function createLogger(
  write: (line: string) => void,
  now: () => Date = () => new Date(),
): Logger {
  const emitLine = (level: LogLevel, msg: string, fields?: LogFields, error?: unknown) => {
    const line: Record<string, string | number> = {
      ts: now().toISOString(),
      level,
      msg,
      ...pick(fields),
    };
    // Only the error's class name: messages can carry request data.
    if (error !== undefined) line.error = error instanceof Error ? error.name : typeof error;
    write(JSON.stringify(line));
  };
  return {
    info: (msg, fields) => {
      emitLine("info", msg, fields);
    },
    warn: (msg, fields) => {
      emitLine("warn", msg, fields);
    },
    error: (msg, fields, error) => {
      emitLine("error", msg, fields, error);
    },
    raw: write,
  };
}

export const log: Logger = createLogger((line) => {
  process.stdout.write(`${line}\n`);
});
