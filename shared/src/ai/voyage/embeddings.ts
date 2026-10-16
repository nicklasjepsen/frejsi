import { z } from "zod";
import type { Logger } from "../../log";
import type { EmbedRequest, EmbedResult } from "../types";
import { embeddings, postJson, unavailable } from "../azure-openai/protocol";

export class VoyageEmbeddings {
  constructor(
    private readonly options: {
      apiKey: string;
      fetch?: typeof globalThis.fetch | undefined;
      logger?: Logger | undefined;
    },
  ) {}
  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const model = "voyage-3.5";
    const response = await postJson(
      this.options.fetch ?? globalThis.fetch,
      "https://api.voyageai.com/v1/embeddings",
      { input: req.texts, model, output_dimension: 1024 },
      () => Promise.resolve({ authorization: `Bearer ${this.options.apiKey}` }),
      10_000,
      this.options.logger,
    );
    const parsed = z.object({ data: z.unknown() }).safeParse(response);
    if (!parsed.success) throw unavailable();
    return embeddings(parsed.data.data, req.texts.length, `voyage:${model}`);
  }
}
