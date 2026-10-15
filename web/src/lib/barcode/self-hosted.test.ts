import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ZXING_WASM_PATH } from "./detect";

const require = createRequire(import.meta.url);
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("self-hosted zxing-wasm", () => {
  it("serves the exact binary of the installed zxing-wasm from web/public/zxing/", () => {
    const publicFile = path.resolve(import.meta.dirname, "../../../public", `.${ZXING_WASM_PATH}`);
    const installed = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
    expect(sha(publicFile)).toBe(sha(installed));
  });
});
