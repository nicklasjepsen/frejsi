"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { HEADER_END_ID } from "./nav";

/**
 * Renders its children at the end of the phone header (the source status pill on Nu). A page
 * cannot reach the layout's header otherwise. Nothing is rendered on desktop, where the header is
 * hidden and the page draws its own status card.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.getElementById(HEADER_END_ID));
  }, []);
  return target ? createPortal(children, target) : null;
}
