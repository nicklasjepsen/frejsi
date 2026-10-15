"use client";
import { useEffect, useState } from "react";
import { localDateOf } from "@/components/day/format";

/** A calendar day advances in the space's zone, including when a tab stays open overnight. */
export function useToday(initial: string, timeZone: string | undefined) {
  const [today, setToday] = useState(initial);
  useEffect(() => {
    if (!timeZone) return;
    const update = () => {
      setToday(localDateOf(new Date(), timeZone));
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, [timeZone]);
  return today;
}
