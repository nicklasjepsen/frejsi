import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { FridaEntry } from "../src/food/frida/entry";

/** Projected DTU Data_Table + Food sheet CSV; headings retain DTU's exact names. */
export function parseFridaCsv(csv: string): FridaEntry[] {
  const delimiter = csv.split(/\r?\n/, 1)[0]?.includes(";") ? ";" : ",";
  const rawRows: unknown = parse(csv, { bom: true, delimiter, skip_empty_lines: true });
  const rows = z.array(z.array(z.string())).parse(rawRows);
  const header = rows.shift() ?? [];
  const columns = ["FoodID", "FødevareNavn", "FoodName", "FoodGroup", "Available carbohydrates"];
  for (const name of columns)
    if (!header.includes(name)) throw new Error(`Missing column: ${name}`);
  const entries: FridaEntry[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const get = (name: string) => (row[header.indexOf(name)] ?? "").trim();
    const raw = get("Available carbohydrates");
    if (raw === "" || raw === "NULL" || raw === "NA") continue;
    const id = Number(get("FoodID"));
    const carbs = Number(raw.replace(",", "."));
    const da = get("FødevareNavn"),
      en = get("FoodName");
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      seen.has(id) ||
      !Number.isFinite(carbs) ||
      carbs < 0 ||
      carbs > 100 ||
      !(da || en) ||
      da.length > 200 ||
      en.length > 200
    )
      throw new Error(`Invalid or duplicate Frida entry at row ${entries.length + 2}`);
    seen.add(id);
    entries.push({
      id,
      name: { da, en },
      carbsPer100g: Math.round(carbs * 10) / 10,
      group: get("FoodGroup"),
    });
  }
  return entries.sort((a, b) => a.id - b.id);
}
export async function importFrida(input: string | URL, output: string | URL): Promise<void> {
  const entries = parseFridaCsv(await readFile(input, "utf8"));
  if (entries.length === 0) throw new Error("Frida export has no available carbohydrate values");
  await writeFile(output, `${JSON.stringify(entries, null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: pnpm --filter ./shared frida:import <csv> [output.json]");
  await importFrida(
    input,
    process.argv[3] ?? new URL("../src/food/frida/data/frida.json", import.meta.url),
  );
}
