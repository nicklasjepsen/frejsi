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

/** A deterministic script; no transport, environment or vendor dependency. */
export class FakeAiProvider implements AiProvider {
  readonly id = "fake";
  readonly calls: RecordedAiCall[] = [];
  private readonly script: Answer[];
  constructor(script: readonly Answer[] = []) {
    this.script = [...script];
  }
  capabilities() {
    return { complete: true, vision: true, embed: true };
  }
  complete(request: CompleteRequest): Promise<CompleteResult> {
    this.calls.push({
      kind: "complete",
      request: { ...request, messages: structuredClone(request.messages) },
    });
    return this.nextComplete();
  }
  vision(request: VisionRequest): Promise<CompleteResult> {
    this.calls.push({ kind: "vision", request: { ...request, image: { ...request.image } } });
    return this.nextComplete();
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.calls.push({ kind: "embed", request: structuredClone(request) });
    const answer = await Promise.resolve().then(() => this.next());
    if (!("vectors" in answer)) throw new HttpError(503, "ai-unavailable");
    return answer;
  }
  private next(): CompleteResult | EmbedResult {
    const answer = this.script.shift();
    if (answer === undefined) throw new HttpError(503, "ai-unavailable");
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  }
  private async nextComplete(): Promise<CompleteResult> {
    const answer = await Promise.resolve().then(() => this.next());
    if (!("kind" in answer)) throw new HttpError(503, "ai-unavailable");
    return answer;
  }
}
