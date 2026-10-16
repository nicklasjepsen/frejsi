"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

export function SettingsLiveRefresh({ spaceId }: { spaceId: string }) {
  const { subscribe } = useLiveFeed(spaceId, { readings: false });
  const router = useRouter();
  useEffect(
    () =>
      subscribe("space.updated", () => {
        router.refresh();
      }),
    [subscribe, router],
  );
  return null;
}
