import { z } from "zod";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
/** Azure strict output requires every property; optional properties travel as nullable. */
export function azureSchema(schema: z.ZodType): Record<string, unknown> {
  function strict(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(strict);
    const node = object(value);
    if (!node) return value;
    const out = Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== "default")
        .map(([key, child]) => [key, strict(child)]),
    );
    const properties = object(node.properties);
    if (properties) {
      const required = Array.isArray(node.required) ? node.required : [];
      out.properties = Object.fromEntries(
        Object.entries(properties).map(([key, child]) => [
          key,
          required.includes(key) ? strict(child) : { anyOf: [strict(child), { type: "null" }] },
        ]),
      );
      out.required = Object.keys(properties);
      out.additionalProperties = false;
    }
    return out;
  }
  return strict(z.toJSONSchema(schema, { io: "input" })) as Record<string, unknown>;
}
export function restoreOptionals(value: unknown, schema: z.ZodType): unknown {
  const root = z.toJSONSchema(schema, { io: "input" });
  function allowsNull(node: Record<string, unknown>): boolean {
    return (
      node.type === "null" ||
      (Array.isArray(node.type) && node.type.includes("null")) ||
      node.const === null ||
      (Array.isArray(node.enum) && node.enum.includes(null)) ||
      (Array.isArray(node.anyOf) && node.anyOf.some((branch) => allowsNull(object(branch) ?? {})))
    );
  }
  function normalize(input: unknown, node: Record<string, unknown>): unknown {
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      let resolved: unknown = root;
      for (const key of node.$ref.slice(2).split("/"))
        resolved = object(resolved)?.[key.replaceAll("~1", "/").replaceAll("~0", "~")];
      const target = object(resolved);
      if (target) return normalize(input, target);
    }
    if (Array.isArray(input)) return input.map((item) => normalize(item, object(node.items) ?? {}));
    const data = object(input);
    if (!data) return input;
    let out = { ...data };
    const properties = object(node.properties) ?? {};
    const required = Array.isArray(node.required) ? node.required : [];
    for (const [key, child] of Object.entries(properties)) {
      if (!(key in out)) continue;
      if (out[key] === null && !required.includes(key) && !allowsNull(object(child) ?? {}))
        out = Object.fromEntries(Object.entries(out).filter(([name]) => name !== key));
      else out[key] = normalize(out[key], object(child) ?? {});
    }
    for (const branch of Array.isArray(node.anyOf) ? node.anyOf : []) {
      out = object(normalize(out, object(branch) ?? {})) ?? out;
    }
    return out;
  }
  return normalize(value, root);
}
