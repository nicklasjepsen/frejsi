"use client";
import { useState } from "react";

import type { PhoneView } from "./controller";

export function usePhoneView(initial: PhoneView) {
  const [view, setView] = useState<PhoneView>(initial);
  const [cameraDenied, setCameraDenied] = useState(false);
  return { view, setView, cameraDenied, setCameraDenied };
}
export type PhoneViewState = ReturnType<typeof usePhoneView>;
