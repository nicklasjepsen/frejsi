import { localDateOf } from "@/components/day/format";

/** Keep the completed week visible through the poller's Monday catch-up window. */
export function summaryWeek(now: Date, zone: string): string {
  const date = localDateOf(now, zone);
  const monday = new Date(`${date}T12:00:00Z`);
  const weekday = monday.getUTCDay();
  const hour = Number(
    new Intl.DateTimeFormat("en", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(
      now,
    ),
  );
  const back = weekday === 1 && hour < 6 ? 7 : (weekday + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - back);
  return monday.toISOString().slice(0, 10);
}
