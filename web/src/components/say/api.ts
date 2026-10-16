import { AiUsage, ParsedMeal, PhotoEstimate } from "@frejsi/shared/schemas/ai";
import type { z } from "zod";

async function request<T>(
  spaceId: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error("ai-unavailable");
  return schema.parse(await response.json());
}
export const aiUsage = (spaceId: string) => request(spaceId, "ai", AiUsage);
export const parseText = (spaceId: string, text: string) =>
  request(spaceId, "parse", ParsedMeal, { text });
export function estimatePhoto(spaceId: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return request(spaceId, "estimates", PhotoEstimate, {
    photoDataUrl: `data:image/jpeg;base64,${btoa(binary)}`,
  });
}
