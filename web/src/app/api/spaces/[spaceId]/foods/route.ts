import { AddCandidateRequest, HttpError } from "@frejsi/shared";
import { json } from "@/app/api/auth/http";
import { addCandidate, createFood, listFoods } from "@/lib/foods";
import { foodRoute } from "./http";

export const GET = foodRoute("foods.list", async (request, context) => {
  const query = new URL(request.url).searchParams;
  const result = await listFoods(
    context.spaceId,
    context.session,
    {
      q: query.get("q") ?? "",
      filter: query.get("filter") ?? "all",
      mode: query.get("mode") ?? "keyword",
    },
    context.deps,
  );
  context.count = result.foods.length;
  return json(result);
});
export const POST = foodRoute("foods.create", async (request, context) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "validation");
  }
  let food;
  if (typeof body === "object" && body !== null && "candidate" in body) {
    const candidate = AddCandidateRequest.safeParse(body);
    if (!candidate.success) throw new HttpError(400, "validation");
    food = await addCandidate(
      context.spaceId,
      context.session,
      candidate.data.candidate,
      context.deps,
    );
  } else {
    food = await createFood(context.spaceId, context.session, body, context.deps);
  }
  context.count = 1;
  return json(food, { status: 201 });
});
