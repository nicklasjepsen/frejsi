import { afterEach, expect, it, vi } from "vitest";
import { VoyageEmbeddings } from "./embeddings";
import { fixture, transport } from "../anthropic/test-helpers";

afterEach(() => vi.restoreAllMocks());
it("requests 1024 dimensions with a ten second deadline", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const t = transport(fixture("voyage", "embed"));
  const result = await new VoyageEmbeddings({ apiKey: "fictional", fetch: t.fetch }).embed({
    texts: ["Apple"],
  });
  expect(result.vectors[0]).toHaveLength(1024);
  expect(result.model).toBe("voyage:voyage-3.5");
  expect(t.calls[0]?.body).toEqual({
    input: ["Apple"],
    model: "voyage-3.5",
    output_dimension: 1024,
  });
  expect(t.calls[0]?.headers.get("authorization")).toBe("Bearer fictional");
  expect(timeout).toHaveBeenCalledWith(10_000);
});
it.each(["embed-1536", "missing", "nonfinite", "count", "duplicate"])(
  "rejects invalid vectors: %s",
  async (name) => {
    const body =
      name === "embed-1536"
        ? fixture("voyage", name)
        : name === "nonfinite"
          ? { data: [{ index: 0, embedding: Array(1024).fill("bad") }] }
          : name === "count"
            ? { data: [] }
            : name === "duplicate"
              ? {
                  data: [
                    { index: 0, embedding: Array(1024).fill(0) },
                    { index: 0, embedding: Array(1024).fill(0) },
                  ],
                }
              : {};
    await expect(
      new VoyageEmbeddings({ apiKey: "fictional", fetch: transport(body).fetch }).embed({
        texts: name === "duplicate" ? ["Apple", "Pear"] : ["Apple"],
      }),
    ).rejects.toMatchObject({ code: "ai-unavailable" });
  },
);
