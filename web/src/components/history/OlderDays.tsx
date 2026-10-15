"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import styles from "./history.module.css";

/** IntersectionObserver is progressive enhancement; the button also works without it. */
export function OlderDays({
  load,
  done,
  disabled = false,
}: {
  load: () => void;
  done: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("history");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done || disabled || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      { rootMargin: "200px" },
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
    };
  }, [load, done, disabled]);
  return (
    <div className={styles.older} ref={ref}>
      {done ? (
        <p>{t("end")}</p>
      ) : (
        <button type="button" disabled={disabled} onClick={load}>
          {t("older")}
        </button>
      )}
    </div>
  );
}

export function DayLoading() {
  const t = useTranslations("history");
  return (
    <div
      className={styles.skeleton}
      data-testid="history-loading"
      aria-busy="true"
      aria-label={t("loading")}
    />
  );
}
