"use client";
import { WeekInsightView } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { LiveFeedView } from "@/lib/live/useLiveFeed";
import { useInsight } from "./useInsight";
import styles from "./observation.module.css";
export function WeekObservation({
  spaceId,
  start,
  fetch: fetchImpl,
  feed,
}: {
  spaceId: string;
  start: string;
  fetch?: typeof fetch;
  feed?: Pick<LiveFeedView, "subscribe">;
}) {
  const t = useTranslations("historyWeek.observation");
  const url = `/api/spaces/${encodeURIComponent(spaceId)}/history/week/insight?start=${start}`;
  const { value, load } = useInsight(url, WeekInsightView, fetchImpl, feed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"saved" | "failed" | "copied" | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEditing(false);
    setStatus(null);
  }, [url]);
  if (!value || value.state === "off") return null;
  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await (fetchImpl ?? globalThis.fetch)(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questions: draft
            .split("\n")
            .map((q) => q.trim())
            .filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error("Save failed");
      await load();
      setEditing(false);
      setStatus("saved");
    } catch {
      setStatus("failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section id="opsummering" className={styles.card} data-verified="false">
      <h2 className={styles.phoneSummary}>{t("summary")}</h2>
      {value.state === "ready" ? (
        <>
          <p className={styles.phoneSummary}>{value.summary}</p>
          <div className={styles.heading}>
            <h2>{t("title")}</h2>
            <span className={styles.badge}>{t("badge")}</span>
            <span className={styles.caption}>{t("note")}</span>
          </div>
          {editing ? (
            <label>
              {t("edit")}
              <textarea
                rows={5}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
              />
            </label>
          ) : (
            <ol>
              {value.questions?.map((question, i) => (
                <li key={i}>{question}</li>
              ))}
            </ol>
          )}
          <div className={styles.actions}>
            {editing ? (
              <>
                <button type="button" disabled={saving} onClick={() => void save()}>
                  {t("save")}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  {t("cancel")}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(value.questions?.join("\n") ?? "");
                    setStatus(null);
                    setEditing(true);
                  }}
                >
                  {t("edit")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(value.questions?.map((q, i) => `${i + 1}. ${q}`).join("\n") ?? "")
                      .then(
                        () => {
                          setStatus("copied");
                        },
                        () => {
                          setStatus("failed");
                        },
                      );
                  }}
                >
                  {t("copy")}
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <p>{t("pending")}</p>
      )}
      {status && <p role="status">{t(status)}</p>}
    </section>
  );
}
