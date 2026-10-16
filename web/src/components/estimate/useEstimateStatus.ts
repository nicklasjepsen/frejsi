"use client";
import { useEffect, useState } from "react";
import { loadEstimateStatus, type EstimateStatus } from "./api";

export function useEstimateStatus(spaceId: string) {
  const [status, setStatus] = useState<EstimateStatus | null>(null);
  useEffect(() => {
    let active = true;
    void loadEstimateStatus(spaceId)
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setStatus({ available: false, carers: [] });
      });
    return () => {
      active = false;
    };
  }, [spaceId]);
  return status;
}
