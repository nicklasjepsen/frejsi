"use client";
import { useState } from "react";

import type { ScanFailure } from "@/lib/barcode/detect";

import type { PhoneView } from "./controller";

export function usePhoneView(initial: PhoneView) {
  const [view, setView] = useState<PhoneView>(initial);
  /** Why the last scan could not run; shown above the typed-barcode field until the next scan. */
  const [scanFailure, setScanFailure] = useState<ScanFailure | null>(null);
  return { view, setView, scanFailure, setScanFailure };
}
export type PhoneViewState = ReturnType<typeof usePhoneView>;
