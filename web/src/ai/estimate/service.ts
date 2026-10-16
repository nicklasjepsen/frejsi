import { randomUUID } from "node:crypto";
import {
  createEmit,
  HttpError,
  type EventEnvelope,
  type FoodSource,
  type SessionContext,
} from "@frejsi/shared";
import type { AiProvider } from "@frejsi/shared/ai";
import { estimatePhoto } from "@frejsi/shared/ai/estimate/estimate";
import { guardOutput } from "@frejsi/shared/ai/guard";
import { AskRequest, EstimateRequest } from "@frejsi/shared/schemas/ai";
import { FoodCandidate } from "@frejsi/shared/schemas/food";
import type { PhotoStore } from "@frejsi/shared/photos";
import { aiForSpace } from "@/ai/provider";
import { assertRole } from "@/lib/auth/session";
import { addCandidate, setFoodPhoto } from "@/lib/foods";
import { type FoodTx, type ResolvedFoods } from "@/lib/foods/core";
import { getMessages } from "@/lib/i18n/messages";
import { estimateImage } from "./photo";

interface EstimateDeps {
  provider?: (spaceId: string, session: SessionContext) => Promise<AiProvider>;
}
let overrides: EstimateDeps = {};
export function configureEstimates(deps: EstimateDeps): void {
  overrides = deps;
}

// addCandidate remains the sole food writer. This local source admits only our freshly built
// candidate and has no transport; no new source is installed into the global lookup registry.
const aiSource: FoodSource = {
  id: "ai",
  kind: "local",
  search: () => Promise.resolve({ status: "ok", candidates: [] }),
  byBarcode: () => Promise.resolve({ status: "ok", candidates: [] }),
};
export async function createEstimate(spaceId: string, session: SessionContext, body: unknown) {
  assertRole(session, spaceId, "owner", "carer");
  const bytes = await estimateImage(photoField(body));
  const parsed = EstimateRequest.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "validation");
  const provider = await (overrides.provider ?? aiForSpace)(spaceId, session);
  return estimatePhoto(provider, Buffer.from(bytes).toString("base64"), session.locale);
}
function photoField(body: unknown): unknown {
  return typeof body === "object" && body !== null && "photoDataUrl" in body
    ? body.photoDataUrl
    : undefined;
}
export async function askAboutEstimate(
  spaceId: string,
  session: SessionContext,
  body: unknown,
  deps: ResolvedFoods,
): Promise<{ foodId: string }> {
  assertRole(session, spaceId, "owner", "carer");
  const bytes = await estimateImage(photoField(body));
  const parsed = AskRequest.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "validation");
  const { estimate } = parsed.data;
  guardOutput(estimate);
  if (estimate.totalCarbs !== estimate.items.reduce((sum, item) => sum + item.carbs, 0))
    throw new HttpError(400, "validation");
  const grams = estimate.items.every((item) => item.grams !== undefined)
    ? estimate.items.reduce((sum, item) => sum + (item.grams ?? 0), 0)
    : undefined;
  const candidate = FoodCandidate.safeParse({
    origin: "ai",
    sourceRef: `ai:${randomUUID()}`,
    name: estimate.dishName,
    carbsPer100g: grams === undefined ? null : Math.round((estimate.totalCarbs / grams) * 100),
    portions: [
      {
        label: getMessages(session.locale).ask.portionLabel,
        ...(grams === undefined ? {} : { grams }),
        carbs: estimate.totalCarbs,
      },
    ],
  });
  if (!candidate.success) throw new HttpError(400, "validation");
  if (!deps.photos) throw new HttpError(503, "photo-unavailable");
  const store = deps.photos;
  let uploadedKey: string | undefined;
  const photos: PhotoStore = {
    put: async (key, bytes) => {
      uploadedKey = key;
      await store.put(key, bytes);
    },
    delete: (key) => store.delete(key),
    readUrl: (key, size) => store.readUrl(key, size),
  };
  const queued: { group: string; envelope: EventEnvelope }[] = [];
  const sink = {
    publish: (group: string, envelope: EventEnvelope) => {
      queued.push({ group, envelope });
      return Promise.resolve();
    },
  };
  let result: { foodId: string };
  try {
    result = await deps.db.$transaction(
      async (tx) => {
        const emit = createEmit({ db: { $transaction: (run) => run(tx) }, sink, now: deps.now });
        // Existing services join this transaction and publish only after the outer commit.
        const joined = {
          ...deps,
          sources: [...deps.sources, aiSource],
          photos,
          db: { ...tx, $transaction: <T>(run: (tx: FoodTx) => Promise<T>) => run(tx) },
          sink,
        };
        const food = await addCandidate(spaceId, session, candidate.data, joined);
        await setFoodPhoto(spaceId, session, food.id, bytes, joined);
        await emit(spaceId, "estimate.asked", { foodId: food.id, byUserId: session.userId });
        return { foodId: food.id };
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (uploadedKey) {
      try {
        await store.delete(uploadedKey);
      } catch {
        deps.log.warn("estimate.photo-cleanup-failed", { spaceId, code: "photo-unavailable" });
      }
    }
    throw error;
  }
  for (const { group, envelope } of queued) {
    try {
      await deps.sink.publish(group, envelope);
    } catch {
      deps.log.warn("event.publish-failed", { spaceId, code: "publish-failed" });
    }
  }
  return result;
}
