import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");

describe("food migration", () => {
  it("preserves bounded columns, unverified creation, uniqueness and snapshot relations", () => {
    const sql = readFileSync(
      new URL("../../prisma/migrations/0002_food/migration.sql", import.meta.url),
      "utf8",
    );
    expect(schema).toContain('provider = "sqlserver"');
    for (const table of ["Food", "Meal", "MealItem"])
      expect(sql).toContain(`CREATE TABLE [dbo].[${table}]`);
    for (const [column, length] of [
      ["name", 200],
      ["nameSearch", 200],
      ["barcode", 14],
      ["photoKey", 200],
      ["origin", 20],
      ["sourceRef", 64],
      ["note", 500],
      ["portionLabel", 40],
    ]) {
      expect(sql).toContain(`[${column}] NVARCHAR(${length})`);
    }
    expect(sql).toContain("[carbsPer100g] DECIMAL(5,1)");
    expect(sql).toMatch(/\[verified\] BIT NOT NULL CONSTRAINT .* DEFAULT 0/);
    expect(schema).toContain("@@unique([spaceId, sourceRef])");
    expect(sql).toContain(
      "CONSTRAINT [Food_spaceId_sourceRef_key] UNIQUE NONCLUSTERED ([spaceId],[sourceRef])",
    );
    expect(sql).toMatch(/MealItem_foodId_fkey[^\n]+ON DELETE SET NULL ON UPDATE NO ACTION/);
    expect(sql).toMatch(/MealItem_mealId_fkey[^\n]+ON DELETE CASCADE ON UPDATE NO ACTION/);
    for (const key of [
      "Food_spaceId",
      "Food_createdBy",
      "Food_verifiedBy",
      "Meal_spaceId",
      "Meal_byUserId",
    ]) {
      expect(sql).toMatch(new RegExp(`${key}_fkey[^\\n]+ON DELETE NO ACTION ON UPDATE NO ACTION`));
    }
  });
});
