"use client";

import type { GlucoseUnit } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { resolveLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { formatGlucose } from "./format";
import styles from "./glucose.module.css";
import {
  hitAt,
  tipAnchor,
  type TipHit,
  type TipMark,
  type TipPoint,
  type TipPrevious,
} from "./tooltip";
import { useAgeText } from "./useAgeText";

/**
 * What one curve gives its tooltip (issue 243), in viewBox units. `full` is the day and meal
 * curves: hover, touch-and-hold and the arrow keys. `hover` is the week tile inside its link:
 * the mouse only, read from the nearest `[data-chart-hover]` ancestor, so a tap still opens the day.
 */
export interface TooltipModel {
  mode: "full" | "hover";
  width: number;
  height: number;
  plotWidth: number;
  plotTop: number;
  plotBottom: number;
  points: readonly TipPoint[];
  marks: readonly TipMark[];
  previous: readonly TipPrevious[];
  unit: GlucoseUnit;
  timeZone: string;
  now: Date;
  /** The week tile puts its day in front: "Torsdag 15. oktober · 6,2 mmol/L · …". */
  prefix?: (reading: string) => string;
}

/** How long a finger rests before the tooltip follows it, and how far it may drift before. */
const HOLD_MS = 350;
const HOLD_SLOP_PX = 10;

interface Active {
  hit: TipHit;
  by: "pointer" | "key";
}

/**
 * The reading's line, as `GlucoseValue` reads it: value and unit, the trend word, the clock and
 * the age. The one way the tooltip prints a value, so it can never print one bare (hard rule).
 */
export function useReadingText(): (
  point: TipPoint,
  unit: GlucoseUnit,
  timeZone: string,
  now: Date,
) => string {
  const t = useTranslations("glucose");
  const locale = resolveLocale(useLocale());
  const ageText = useAgeText();
  return (point, unit, timeZone, now) => {
    const values = {
      value: formatGlucose(point.mmol, unit, locale),
      unit: t(`unit.${unit}`),
      time: formatClock(new Date(point.ts), timeZone),
      age: ageText(point.ts, now),
    };
    return point.trend === null || point.trend === "not-computable"
      ? t("tooltip.readingNoTrend", values)
      : t("tooltip.reading", { ...values, trend: t(`trend.${point.trend}`) });
  };
}

/**
 * The curve's tooltip around its chart: a thin guide and a dot on the reading under the pointer,
 * and a positioned `<div>` naming it, or naming the marker or earlier curve under it. The marker
 * buttons below keep their taps; the tooltip never takes a pointer event of its own.
 */
export function CurveTooltip({ model, children }: { model: TooltipModel; children: ReactNode }) {
  const t = useTranslations("chart");
  const readingText = useReadingText();
  const hintId = useId();
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const full = model.mode === "full";

  // A pointer position on screen → what is under it, from the chart's rendered box.
  const hitFor = useCallback(
    (clientX: number, clientY: number): TipHit | null => {
      if (!node) return null;
      const m = modelRef.current;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      if (
        clientX < rect.left ||
        clientX > rect.left + rect.width ||
        clientY < rect.top ||
        clientY > rect.top + rect.height
      )
        return null;
      const sx = m.width / rect.width;
      const sy = m.height / rect.height;
      const x = Math.min(m.plotWidth, Math.max(0, (clientX - rect.left) * sx));
      const y = (clientY - rect.top) * sy;
      return hitAt({ x, y, sx, sy, points: m.points, marks: m.marks, previous: m.previous });
    },
    [node],
  );

  // Pointer events are read natively: on the chart itself, or for the week tile on the tile
  // whose link lies over the chart, so the tile's own tap is never taken from it.
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    x: number;
    y: number;
    on: boolean;
  }>({
    timer: null,
    x: 0,
    y: 0,
    on: false,
  });
  const swallowClick = useRef(false);
  useEffect(() => {
    if (!node) return;
    const area = full ? node : (node.closest<HTMLElement>("[data-chart-hover]") ?? node);
    const show = (x: number, y: number) => {
      const hit = hitFor(x, y);
      setActive(hit ? { hit, by: "pointer" } : null);
    };
    const hide = () => {
      setActive((current) => (current?.by === "pointer" ? null : current));
    };
    const stopHold = () => {
      if (hold.current.timer !== null) clearTimeout(hold.current.timer);
      hold.current.timer = null;
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (!full) return;
        if (hold.current.on) {
          show(event.clientX, event.clientY);
        } else if (
          hold.current.timer !== null &&
          Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > HOLD_SLOP_PX
        ) {
          stopHold();
        }
        return;
      }
      show(event.clientX, event.clientY);
    };
    const onDown = (event: PointerEvent) => {
      swallowClick.current = false;
      if (!full || event.pointerType !== "touch") return;
      stopHold();
      hold.current = {
        x: event.clientX,
        y: event.clientY,
        on: false,
        timer: setTimeout(() => {
          hold.current.timer = null;
          hold.current.on = true;
          // The finger that held is reading the curve: its release is not a tap.
          swallowClick.current = true;
          show(hold.current.x, hold.current.y);
        }, HOLD_MS),
      };
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      stopHold();
      if (hold.current.on) {
        hold.current.on = false;
        hide();
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== "touch") hide();
    };
    area.addEventListener("pointermove", onMove);
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointerup", onUp);
    area.addEventListener("pointercancel", onUp);
    area.addEventListener("pointerleave", onLeave);
    return () => {
      stopHold();
      area.removeEventListener("pointermove", onMove);
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointerup", onUp);
      area.removeEventListener("pointercancel", onUp);
      area.removeEventListener("pointerleave", onLeave);
    };
  }, [node, full, hitFor]);

  const onKeyDown = (event: KeyboardEvent) => {
    const count = model.points.length;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (count === 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = active?.by === "key" && active.hit.kind === "reading" ? active.hit.index : null;
    let index: number;
    if (event.key === "Home") index = 0;
    else if (event.key === "End" || current === null) index = count - 1;
    else index = current + (event.key === "ArrowLeft" ? -1 : 1);
    index = Math.min(count - 1, Math.max(0, index));
    setActive({ hit: { kind: "reading", index }, by: "key" });
  };

  const view = active ? describe(active.hit, model) : null;
  const text = view
    ? view.point
      ? (model.prefix ?? ((s: string) => s))(
          readingText(view.point, model.unit, model.timeZone, model.now),
        )
      : view.name
    : null;
  const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;
  const anchor = view ? tipAnchor(view.x, model.plotWidth) : "middle";
  const anchorY = view?.y ?? (model.plotTop + model.plotBottom) / 2;
  const above = anchorY / model.height > 0.45;
  const xShare = view ? view.x / model.width : 0;

  // Once laid out, the card is kept inside the chart: shifted from the guide as far as it must be.
  // Wider than the chart (a week tile), it opens away from the nearer edge instead.
  const tipRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip || !node) return;
    const hostWidth = node.getBoundingClientRect().width;
    const width = tip.offsetWidth;
    if (hostWidth <= 0 || width <= 0 || width > hostWidth) return;
    const left = Math.min(hostWidth - width, Math.max(0, xShare * hostWidth - width / 2));
    tip.style.left = `${left.toFixed(1)}px`;
    tip.style.transform = `translateY(${above ? "calc(-100% - 12px)" : "12px"})`;
  }, [node, xShare, above, text]);

  return (
    <div
      ref={setNode}
      className={full ? styles.curveHost : styles.tileHost}
      data-testid="curve-host"
      {...(full
        ? {
            tabIndex: 0,
            role: "group",
            "aria-describedby": hintId,
            onKeyDown,
            onBlur: () => {
              setActive((current) => (current?.by === "key" ? null : current));
            },
            onClickCapture: (event: MouseEvent) => {
              if (!swallowClick.current) return;
              swallowClick.current = false;
              event.preventDefault();
              event.stopPropagation();
            },
          }
        : {})}
    >
      {children}
      {view && text !== null && (
        <>
          <div
            className={styles.curveGuide}
            style={{
              left: pct(view.x, model.width),
              top: pct(model.plotTop, model.height),
              height: pct(model.plotBottom - model.plotTop, model.height),
            }}
            aria-hidden="true"
            data-testid="curve-guide"
          />
          {view.y !== null && (
            <div
              className={styles.curveDot}
              style={{ left: pct(view.x, model.width), top: pct(view.y, model.height) }}
              aria-hidden="true"
              data-testid="curve-dot"
            />
          )}
          <div
            ref={tipRef}
            className={styles.curveTooltip}
            style={{
              left: pct(view.x, model.width),
              top: pct(anchorY, model.height),
              transform: `translate(${anchor === "start" ? "0" : anchor === "end" ? "-100%" : "-50%"}, ${above ? "calc(-100% - 12px)" : "12px"})`,
            }}
            data-anchor={anchor}
            aria-hidden="true"
            data-testid="curve-tooltip"
          >
            {text}
          </div>
        </>
      )}
      {full && (
        <>
          <p id={hintId} className="sr-only">
            {t("tooltip.keys")}
          </p>
          <p className="sr-only" aria-live="polite" data-testid="curve-live">
            {active?.by === "key" && text !== null ? text : ""}
          </p>
        </>
      )}
    </div>
  );
}

/** Where the hit sits and what names it: a reading's point, or a marker's or curve's name. */
function describe(
  hit: TipHit,
  model: TooltipModel,
): { x: number; y: number | null; point: TipPoint | null; name: string } | null {
  switch (hit.kind) {
    case "reading": {
      const point = model.points[hit.index];
      return point ? { x: point.x, y: point.y, point, name: "" } : null;
    }
    case "mark":
      return { x: hit.mark.x, y: null, point: null, name: hit.mark.name };
    default: {
      const curve = model.previous[hit.curve];
      return curve ? { x: hit.x, y: hit.y, point: null, name: curve.name } : null;
    }
  }
}
