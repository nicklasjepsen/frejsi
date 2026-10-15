import {
  AddCandidateRequest,
  HttpError,
  type FoodCandidate,
  type FoodSource,
  type SessionContext,
} from "@frejsi/shared";

/** Client fields identify a pick, but can never author cross-space source data. */
export async function confirmRemoteCandidate(
  source: FoodSource,
  candidate: FoodCandidate,
  locale: SessionContext["locale"],
): Promise<FoodCandidate> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result;
  try {
    result = await Promise.race([
      Promise.resolve().then(() =>
        candidate.barcode
          ? source.byBarcode(candidate.barcode, controller.signal)
          : source.search(candidate.name, locale, controller.signal),
      ),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, 2500);
      }),
    ]);
  } catch {
    throw new HttpError(503, "lookup-unavailable");
  } finally {
    clearTimeout(timer);
  }
  if (result.status !== "ok") throw new HttpError(503, "lookup-unavailable");
  const found = result.candidates.find(
    (food) =>
      food.sourceRef === candidate.sourceRef ||
      (candidate.barcode !== undefined &&
        candidate.sourceRef === `${source.id}:${candidate.barcode}` &&
        food.barcode === candidate.barcode),
  );
  if (!found) throw new HttpError(400, "validation");
  const parsed = AddCandidateRequest.safeParse({
    candidate: { ...found, origin: source.id, sourceRef: candidate.sourceRef },
  });
  if (!parsed.success) throw new HttpError(503, "lookup-unavailable");
  return parsed.data.candidate;
}
