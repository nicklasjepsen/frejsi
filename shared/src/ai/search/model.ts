import { createHash } from "node:crypto";

/** A release/configuration revision detects model changes without a paid discovery call.
 * The current AiProvider contract exposes model identity only after embed(). Including the
 * release also catches changed adapter defaults; web and poller use the same release tag. */
export function embeddingRevision(
  provider: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const prefix = provider.replaceAll("-", "_").toUpperCase() + "_";
  const config = Object.entries(env)
    .filter(
      ([key]) =>
        key === "FAKE_AI_PROVIDER" ||
        (key.startsWith(prefix) && /EMBED|ENDPOINT|URL/.test(key) && !/KEY|CAP/.test(key)),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const release = env.APP_VERSION ?? env.NEXT_PUBLIC_APP_VERSION ?? "development";
  const hash = createHash("sha256")
    .update(JSON.stringify([release, config]))
    .digest("hex")
    .slice(0, 12);
  return `${provider}:${hash}:`;
}
export function embeddingIdentity(revision: string, model: string): string {
  const full = `${revision}${model}`;
  return full.length <= 80
    ? full
    : `${revision}${createHash("sha256").update(model).digest("hex").slice(0, 32)}`;
}
