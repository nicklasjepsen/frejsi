import { randomUUID } from "node:crypto";

const segment = /^[A-Za-z0-9_-]{1,64}$/;
const pattern =
  /^spaces\/([A-Za-z0-9_-]{1,64})\/(foods|meals)\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/;
export type PhotoKind = "foods" | "meals";

/** A new immutable key per upload prevents stale cached URLs after replacing a photo. */
export function photoKey(spaceId: string, kind: PhotoKind, id: string): string {
  if (!segment.test(spaceId) || !segment.test(id) || !["foods", "meals"].includes(kind)) {
    throw new Error("photo-key");
  }
  return `spaces/${spaceId}/${kind}/${id}/${randomUUID()}`;
}

export function parsePhotoKey(
  key: string,
): { spaceId: string; kind: PhotoKind; id: string } | null {
  const match = pattern.exec(key);
  if (!match || key.length > 200) return null;
  const [, spaceId, kind, id] = match;
  if (!spaceId || !id || (kind !== "foods" && kind !== "meals")) return null;
  return { spaceId, kind, id };
}

export function assertPhotoKey(key: string): void {
  if (!parsePhotoKey(key)) throw new Error("photo-key");
}
