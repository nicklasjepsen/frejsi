"use client";
import type { CreateSymptomRequest, SpaceSymptomKind, SymptomKind, SymptomView } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";
import { createSymptom, deleteSymptom, loadSymptomKinds } from "./api";
import { SymptomIcon } from "./icons";
import { ALL_KINDS, useKindLabel } from "./kinds";
import { SymptomSheet } from "./SymptomSheet";
import styles from "./symptoms.module.css";
import { useSymptoms } from "./useSymptoms";

export interface SymptomPickerProps {
  spaceId: string;
  locale: AppLocale;
  /** simpleMode: tiles only, at 84 px; no sheet, no severity (plan §5). */
  simple: boolean;
  timeZone: string;
  now?: () => Date;
  /** How long "Fortryd" stays, in ms; ten seconds unless a test shortens it. */
  undoMs?: number;
}

type KindsLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; kinds: SpaceSymptomKind[] };
type Toast = { id: string; kind: SymptomKind; undone: false } | { undone: true };
const UNDO_MS = 10_000;

/**
 * Jeg har det… (`/feel`, plan §5): six large tiles with a picture and a name, plus the space's own
 * kinds. One tap logs the kind at now and says "Logget" with "Fortryd" for ten seconds; "Mere…"
 * opens the sheet. Below the tiles, today's entries, live. A simpleMode member logs and does not
 * edit afterwards (plan §12, decision 7), so Fortryd is an adult's button.
 */
export function SymptomPicker({
  spaceId,
  locale,
  simple,
  timeZone,
  now = () => new Date(),
  undoMs = UNDO_MS,
}: SymptomPickerProps) {
  const t = useTranslations("symptoms");
  const router = useRouter();
  const [load, setLoad] = useState<KindsLoad>({ status: "loading" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [sheet, setSheet] = useState<SymptomKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  const spaceKinds = load.status === "ready" ? load.kinds : [];
  const labelOf = useKindLabel(locale, spaceKinds);
  const list = useSymptoms(spaceId, timeZone, now);
  const refresh = list.refresh;

  const fetchKinds = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      setLoad({ status: "ready", kinds: await loadSymptomKinds(spaceId) });
    } catch {
      setLoad({ status: "failed" });
    }
  }, [spaceId]);
  useEffect(() => {
    live.current = true;
    void fetchKinds();
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchKinds]);

  function announce(next: Toast) {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => {
      if (live.current) setToast(null);
    }, undoMs);
  }
  async function log(body: CreateSymptomRequest | { kind: SymptomKind }) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const saved: SymptomView = await createSymptom(spaceId, body);
      if (!live.current) return;
      setSheet(null);
      announce({ id: saved.id, kind: saved.kind, undone: false });
      refresh();
    } catch {
      if (live.current) setFailed(true);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function undo() {
    if (!toast || toast.undone || busy) return;
    setBusy(true);
    try {
      await deleteSymptom(spaceId, toast.id);
      if (!live.current) return;
      announce({ undone: true });
      refresh();
    } catch {
      if (live.current) setFailed(true);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const today = list.status === "ready" ? [...list.symptoms].reverse() : [];

  return (
    <div className={styles.page} data-simple={simple} data-testid="feel">
      <PageHeader
        title={t("title")}
        simple={simple}
        onClose={() => {
          router.push(localeHref(locale, "/now"));
        }}
      />
      {!simple && <p className={styles.intro}>{t("intro")}</p>}
      {load.status === "loading" && <div aria-busy="true" data-testid="feel-loading" />}
      {load.status === "failed" && (
        <>
          <Notice tone="sunken" role="alert">
            {t("loadFailed")}
          </Notice>
          <Button variant="secondary" size={simple ? "simple" : "phone"} onClick={() => void fetchKinds()}>
            {t("retry")}
          </Button>
        </>
      )}
      {toast && (
        <div className={styles.status} role="status" data-testid="feel-status">
          <span>{toast.undone ? t("undone") : t("loggedKind", { kind: labelOf(toast.kind) })}</span>
          {!toast.undone && !simple && (
            <button type="button" className={styles.undo} disabled={busy} onClick={() => void undo()}>
              {t("undo")}
            </button>
          )}
        </div>
      )}
      {failed && !sheet && (
        <Notice tone="sunken" role="alert">
          {t("saveFailed")}
        </Notice>
      )}
      {load.status === "ready" && !sheet && (
        <>
          <div className={styles.grid} data-testid="feel-grid">
            {ALL_KINDS(spaceKinds).map((kind) => (
              <button
                key={kind}
                type="button"
                className={styles.tile}
                disabled={busy}
                onClick={() => void log({ kind })}
              >
                <SymptomIcon kind={kind} size={simple ? 44 : 36} />
                <span>{labelOf(kind)}</span>
              </button>
            ))}
          </div>
          {!simple && (
            <button
              type="button"
              className={styles.more}
              disabled={busy}
              onClick={() => {
                setFailed(false);
                setSheet("stomach-ache");
              }}
            >
              {t("more")}
            </button>
          )}
        </>
      )}
      {sheet && !simple && (
        <SymptomSheet
          locale={locale}
          timeZone={timeZone}
          spaceKinds={spaceKinds}
          initialKind={sheet}
          busy={busy}
          failed={failed}
          now={now}
          onSave={(body) => void log(body)}
          onClose={() => {
            setSheet(null);
            setFailed(false);
          }}
        />
      )}
      {list.status === "ready" && (
        <section className={styles.list} aria-label={t("today")} data-testid="feel-today">
          <h2>{t("today")}</h2>
          {today.length === 0 ? (
            <p className={styles.muted}>{t("none")}</p>
          ) : (
            <ul className={styles.list}>
              {today.map((entry) => (
                <li key={entry.id} className={styles.entry} data-testid="feel-entry">
                  <SymptomIcon kind={entry.kind} size={24} />
                  <span>
                    {t("entry", {
                      kind: labelOf(entry.kind),
                      time: formatClock(new Date(entry.ts), timeZone),
                      name: entry.byName,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
