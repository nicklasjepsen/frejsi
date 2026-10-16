import { AiUsage, ParsedMeal, PhotoEstimate } from "@frejsi/shared/schemas/ai";
import { ParseAvailability } from "@/ai/parse/contract";
import type { z } from "zod";

class AiRequestError extends Error {
  constructor(readonly status: number) {
    super("ai-unavailable");
  }
}

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
  if (!response.ok) throw new AiRequestError(response.status);
  return schema.parse(await response.json());
}
export async function aiUsage(spaceId: string): Promise<{ enabled: boolean }> {
  try {
    return await request(spaceId, "ai", AiUsage);
  } catch (error) {
    if (error instanceof AiRequestError && error.status === 404)
      return request(spaceId, "parse", ParseAvailability);
    throw error;
  }
}
export const parseText = (spaceId: string, text: string) =>
  request(spaceId, "parse", ParsedMeal, { text });
export function estimatePhoto(spaceId: string, bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return request(spaceId, "estimates", PhotoEstimate, {
    photoDataUrl: `data:image/jpeg;base64,${btoa(binary)}`,
  });
}
