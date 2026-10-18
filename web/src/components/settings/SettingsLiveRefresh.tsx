"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

/**
 * Refreshes the server-rendered Settings when the space changes. With `pump`, also when the pump
 * record's import or connection health changes (`pump.imported`, `pump.status`), so the newest
 * record and its age, or a failing connection, show without a reload. Only owners and carers
 * outside simpleMode pass it; the feed carries those events to nobody else.
 */
export function SettingsLiveRefresh({ spaceId, pump = false }: { spaceId: string; pump?: boolean }) {
  const { subscribe } = useLiveFeed(spaceId, { readings: false });
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      router.refresh();
    };
    const off = [subscribe("space.updated", refresh)];
    if (pump) {
      off.push(subscribe("pump.imported", refresh), subscribe("pump.status", refresh));
    }
    return () => {
      off.forEach((fn) => {
        fn();
      });
    };
  }, [subscribe, router, pump]);
  return null;
}
