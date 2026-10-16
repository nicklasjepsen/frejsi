"use client";

import { useEffect, type RefObject } from "react";

/**
 * Keeps the page from scrolling behind a sheet. `showModal()` puts a `<dialog>` in the top layer
 * but does nothing to the document behind it, and Mobile Safari scrolls that document when a
 * finger drags inside the sheet. `overflow: hidden` alone is not enough there; the fix that works
 * is to fix the body in place at its current scroll offset and put it back on close.
 *
 * Locks are counted, so two open sheets share one lock and the document's own inline styles are
 * restored only when the last one closes.
 */

interface Saved {
  scrollY: number;
  htmlOverflow: string;
  body: {
    overflow: string;
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
  };
}

let locks = 0;
let saved: Saved | null = null;

export function lockScroll(): void {
  locks += 1;
  if (locks > 1 || typeof document === "undefined") return;
  const html = document.documentElement;
  const body = document.body;
  saved = {
    scrollY: window.scrollY,
    htmlOverflow: html.style.overflow,
    body: {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    },
  };
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${String(saved.scrollY)}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

export function unlockScroll(): void {
  if (locks === 0) return;
  locks -= 1;
  if (locks > 0 || !saved || typeof document === "undefined") return;
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = saved.htmlOverflow;
  body.style.overflow = saved.body.overflow;
  body.style.position = saved.body.position;
  body.style.top = saved.body.top;
  body.style.left = saved.body.left;
  body.style.right = saved.body.right;
  body.style.width = saved.body.width;
  const { scrollY } = saved;
  saved = null;
  // Un-fixing the body puts the document back at the top: scroll to where it was.
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

/**
 * Locks the page while the `<dialog>` in `ref` is open, whether it opened with `showModal()` in an
 * effect or on a tap, and whether it closed by its button, Escape or unmounting. The dialog's own
 * scrolling is kept inside it (`overscroll-behavior: contain`). Call it once from the component
 * that renders the dialog, with the same ref.
 */
export function useDialogScrollLock(ref: RefObject<HTMLDialogElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof MutationObserver === "undefined") return;
    let locked = false;
    const sync = () => {
      if (node.open && !locked) {
        locked = true;
        lockScroll();
      } else if (!node.open && locked) {
        locked = false;
        unlockScroll();
      }
    };
    const overscroll = node.style.overscrollBehavior;
    node.style.overscrollBehavior = "contain";
    const observer = new MutationObserver(sync);
    observer.observe(node, { attributes: true, attributeFilter: ["open"] });
    sync();
    return () => {
      observer.disconnect();
      node.style.overscrollBehavior = overscroll;
      if (locked) unlockScroll();
    };
  }, [ref]);
}
