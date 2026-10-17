import { SpaceSymptomKind, SymptomView, SymptomsView } from "@frejsi/shared/schemas/symptom";
import type { CreateSymptomRequest, UpdateSymptomRequest } from "@frejsi/shared/schemas/symptom";
import { z } from "zod";

export class SymptomRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function send(
  spaceId: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const response = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    let code = "unknown";
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      code = "unknown";
    }
    throw new SymptomRequestError(response.status, code);
  }
  return response;
}
async function request<T>(
  spaceId: string,
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  return schema.parse(await (await send(spaceId, path, init)).json());
}
const Kinds = z.strictObject({ kinds: z.array(SpaceSymptomKind) });
export const loadSymptomKinds = (spaceId: string) =>
  request(spaceId, "symptoms/kinds", Kinds).then((answer) => answer.kinds);
export const loadSymptoms = (spaceId: string, from: string, to: string) =>
  request(
    spaceId,
    `symptoms?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    SymptomsView,
  ).then((answer) => answer.symptoms);
/** A simpleMode session sends the kind alone; the route refuses anything else. */
export const createSymptom = (spaceId: string, body: CreateSymptomRequest | { kind: string }) =>
  request(spaceId, "symptoms", SymptomView, { body });
export const updateSymptom = (spaceId: string, id: string, body: UpdateSymptomRequest) =>
  request(spaceId, `symptoms/${encodeURIComponent(id)}`, SymptomView, { method: "PATCH", body });
export async function deleteSymptom(spaceId: string, id: string): Promise<void> {
  await send(spaceId, `symptoms/${encodeURIComponent(id)}`, { method: "DELETE" });
}
