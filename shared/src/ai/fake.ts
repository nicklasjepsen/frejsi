import { LookupResponse } from "../schemas/food";
import { HttpError } from "../schemas/api";
import type {
  AiProvider,
  CompleteRequest,
  CompleteResult,
  EmbedRequest,
  EmbedResult,
  VisionRequest,
} from "./types";

type Answer = CompleteResult | EmbedResult | Error;
export type RecordedAiCall =
  | { kind: "complete"; request: CompleteRequest }
  | { kind: "vision"; request: VisionRequest }
  | { kind: "embed"; request: EmbedRequest };

export type FakeAiScript = readonly Answer[] | ((call: RecordedAiCall) => Answer | Promise<Answer>);

/** Fictional, repeatable outputs for opt-in local/e2e mode. Tests may replace the script. */
export function defaultFakeAnswer(call: RecordedAiCall): Answer {
  if (call.kind === "embed")
    return {
      model: "fixture",
      vectors: call.request.texts.map(() => [1, ...Array<number>(1023).fill(0)]),
    };
  const item = { name: "Example pasta", carbs: 30, grams: 100, confidence: "medium", approx: true };
  if (
    call.kind === "complete" &&
    call.request.use === "parse" &&
    call.request.tools?.some((tool) => tool.name === "lookup")
  ) {
    const previous = call.request.messages
      .flatMap((message) => message.content)
      .findLast(
        (content) => content.type === "tool-result" && content.toolCallId === "fixture-lookup",
      );
    if (previous?.type !== "tool-result")
      return {
        kind: "tool-calls",
        model: "fixture",
        calls: [{ id: "fixture-lookup", name: "lookup", input: { query: "Example pasta" } }],
      };
    const response = LookupResponse.safeParse(previous.result);
    const found = response.success ? response.data.results[0] : undefined;
    const portion = found?.food.portions[0];
    if (found && !portion && found.food.carbsPer100g == null)
      return { kind: "json", model: "fixture", json: { items: [], unmatched: ["Example pasta"] } };
    return {
      kind: "json",
      model: "fixture",
      json: {
        items: [
          {
            query: "Example pasta",
            ...(found
              ? {
                  match: {
                    source: found.source,
                    food: found.food,
                    ...(portion ? { portionLabel: portion.label } : { grams: 100 }),
                  },
                }
              : { estimate: item }),
          },
        ],
        unmatched: [],
      },
    };
  }
  const samples: unknown[] = [
    { items: [{ query: "Example pasta", estimate: item }], unmatched: [] },
    { items: [item], totalCarbs: 30, dishName: "Example dish", approx: true },
    { name: "Example loaf", portions: [{ label: "1 slice", grams: 45, carbs: 18 }] },
    { text: "The peak followed the meal by about an hour." },
    {
      summary: "This week includes twenty-one meals across seven days.",
      questions: ["What patterns appeared after lunch this week?"],
    },
  ];
  const schema = call.request.outputSchema;
  if (schema) {
    for (const json of samples)
      if (schema.safeParse(json).success) return { kind: "json", json, model: "fixture" };
  }
  throw new HttpError(503, "ai-unavailable");
}

/** A deterministic script; no transport, environment or vendor dependency. */
export class FakeAiProvider implements AiProvider {
  readonly id = "fake";
  readonly calls: RecordedAiCall[] = [];
  private readonly script: Answer[] | ((call: RecordedAiCall) => Answer | Promise<Answer>);
  constructor(script: FakeAiScript = []) {
    this.script = typeof script === "function" ? script : [...script];
  }
  capabilities() {
    return { complete: true, vision: true, embed: true };
  }
  complete(request: CompleteRequest): Promise<CompleteResult> {
    const call: RecordedAiCall = {
      kind: "complete",
      request: { ...request, messages: structuredClone(request.messages) },
    };
    this.calls.push(call);
    return this.nextComplete(call);
  }
  vision(request: VisionRequest): Promise<CompleteResult> {
    const call: RecordedAiCall = {
      kind: "vision",
      request: { ...request, image: { ...request.image } },
    };
    this.calls.push(call);
    return this.nextComplete(call);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const call: RecordedAiCall = { kind: "embed", request: structuredClone(request) };
    this.calls.push(call);
    const answer = await this.next(call);
    if (!("vectors" in answer)) throw new HttpError(503, "ai-unavailable");
    return answer;
  }
  private async next(call: RecordedAiCall): Promise<CompleteResult | EmbedResult> {
    const answer =
      typeof this.script === "function" ? await this.script(call) : this.script.shift();
    if (answer === undefined) throw new HttpError(503, "ai-unavailable");
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
  private async nextComplete(call: RecordedAiCall): Promise<CompleteResult> {
    const answer = await this.next(call);
    if (!("kind" in answer)) throw new HttpError(503, "ai-unavailable");
    return answer;
  }
}
