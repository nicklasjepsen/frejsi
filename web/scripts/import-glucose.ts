// `pnpm --filter ./web import -- <file> --space <spaceId> --user <userId> [--no-meals]` (#156):
// imports an export file through `importGlucose`, the service behind POST /api/spaces/:id/import,
// into the database DATABASE_URL names. The user must own the space, checked before the file is
// read. Prints counts only: never a row of the file, a name or the environment.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { emit, GlucoseImportRequest, HttpError, prisma } from "@frejsi/shared";

import { parseArgs, requireOwner } from "../src/lib/import/cli";
import { importGlucose } from "../src/lib/import/service";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    include: { memberships: true },
  });
  const session = requireOwner(user, args.spaceId);

  const text = await readFile(args.file, "utf8");
  const parsed = GlucoseImportRequest.safeParse({ text, createMeals: args.createMeals });
  if (!parsed.success) throw new HttpError(400, "validation");

  // The route's meal deps with no photo store: an import has no photos.
  const result = await importGlucose(args.spaceId, session, parsed.data, {
    db: prisma,
    emit,
    meals: { photos: null },
  });
  const { readings, meals } = result;
  process.stdout.write(
    [
      `space ${args.spaceId}`,
      `format ${result.format}`,
      `readings added ${String(readings.added)}, skipped ${String(readings.skipped)}, from ${readings.from ?? "-"}, to ${readings.to ?? "-"}`,
      `meals added ${String(meals.added)}, skipped ${String(meals.skipped)}`,
      `other rows ${String(result.otherRows)}`,
    ].join("\n") + "\n",
  );
}

if (path.basename(process.argv[1] ?? "") === "import-glucose.ts") {
  main()
    .catch((error: unknown) => {
      const code = error instanceof HttpError ? error.code : "internal";
      process.stderr.write(`import: ${code}\n`);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
