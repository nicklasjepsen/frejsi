import { prisma, type SessionContext } from "@naensom/shared";
import type { SearchEmbed } from "@naensom/shared/food/types";
import { embeddingRevision } from "@naensom/shared/ai/search/model";
import { searchEmbed } from "@naensom/shared/ai/search/embed";
import { aiForSpace } from "@/ai/provider";

/** Factory failures and exhausted search calls all degrade to the keyword library. */
export async function foodSearchEmbed(
  spaceId: string,
  session: SessionContext,
): Promise<SearchEmbed | null> {
  try {
    const provider = await aiForSpace(spaceId, session);
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { aiProvider: true },
    });
    if (!space?.aiProvider) return null;
    return searchEmbed(provider, embeddingRevision(space.aiProvider, process.env));
  } catch {
    return null;
  }
}
