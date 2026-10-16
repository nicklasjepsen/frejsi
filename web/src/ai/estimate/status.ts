import { dayRange, prisma, type SessionContext } from "@frejsi/shared";
import { PrismaAiCallRepository } from "@frejsi/shared/ai";
import { aiForSpace } from "@/ai/provider";
import { assertRole } from "@/lib/auth/session";

interface Member {
  userId: string;
  role: string;
  user: { name: string };
}
interface StatusDeps {
  provider?: typeof aiForSpace;
  members?: (spaceId: string) => Promise<Member[]>;
  remaining?: (spaceId: string) => Promise<boolean>;
}
async function remaining(spaceId: string) {
  const space = await prisma.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { timezone: true },
  });
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: space.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const [from, to] = dayRange(`${part("year")}-${part("month")}-${part("day")}`, space.timezone);
  const count = await new PrismaAiCallRepository(prisma).count({
    spaceId,
    from,
    to,
    kinds: ["complete", "vision"],
  });
  const configuredCap = process.env.AI_DAILY_CAP;
  return count < Number(configuredCap === "" ? 50 : (configuredCap ?? 50));
}
/** No content is sent to a provider by this read; capability and local usage only. */
export async function estimateStatus(
  spaceId: string,
  session: SessionContext,
  deps: StatusDeps = {},
) {
  assertRole(session, spaceId, "owner", "carer");
  const members = await (
    deps.members ??
    ((id) =>
      prisma.membership.findMany({
        where: { spaceId: id },
        select: { userId: true, role: true, user: { select: { name: true } } },
      }))
  )(spaceId);
  const carers = members
    .filter(
      (member) =>
        member.userId !== session.userId && (member.role === "owner" || member.role === "carer"),
    )
    .map((member) => member.user.name);
  let available = false;
  try {
    const provider = await (deps.provider ?? aiForSpace)(spaceId, session);
    available = provider.capabilities().vision && (await (deps.remaining ?? remaining)(spaceId));
  } catch {
    /* Capture remains hidden while AI cannot be used. */
  }
  return { available, carers };
}
