import { z } from "zod";
import { PhotoEstimate } from "@frejsi/shared/schemas/ai";
import { ApiError } from "@frejsi/shared/schemas/api";

export const EstimateStatus = z.strictObject({
  available: z.boolean(),
  carers: z.array(z.string()),
});
export type EstimateStatus = z.infer<typeof EstimateStatus>;
export class EstimateError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const base = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/estimates`;
async function send(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiError.safeParse(json);
    throw new EstimateError(parsed.success ? parsed.data.error.code : "internal");
  }
  return json;
}
export async function loadEstimateStatus(spaceId: string) {
  return EstimateStatus.parse(await send(base(spaceId)));
}
export async function requestEstimate(spaceId: string, photoDataUrl: string) {
  return PhotoEstimate.parse(await send(base(spaceId), { photoDataUrl }));
}
export async function askEstimate(spaceId: string, estimate: PhotoEstimate, photoDataUrl: string) {
  return z
    .strictObject({ foodId: z.string().min(1) })
    .parse(await send(`${base(spaceId)}/ask`, { estimate, photoDataUrl }));
}
export function photoUrl(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
