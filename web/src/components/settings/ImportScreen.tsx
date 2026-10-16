"use client";

// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode, GlucoseImportResult } from "@frejsi/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PageHeader } from "./controls";
import { failureCode, settingsApi, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";

export interface ImportScreenProps {
  locale: AppLocale;
  spaceId: string;
  /** The space's timezone, named so the owner knows how the file's times are read. */
  timezone: string;
  api?: SettingsApi;
}

/**
 * Importér (#154; no artboard, design gap): one file picker, the meals switch and a result card.
 * The file is read in the browser and posted as text; the server answers with counts, which is
 * all this screen ever shows of it. The format name comes from the message for the format. The
 * native file input stays in the DOM for the browser's own picker but is drawn as a button in
 * the person's language, with the chosen file's name beside it.
 */
export function ImportScreen({
  locale,
  spaceId,
  timezone,
  api = settingsApi(),
}: ImportScreenProps) {
  const t = useTranslations("settings.import");
  const settings = useTranslations("settings");
  const errors = useTranslations("errors.api");
  const format = useFormatter();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [createMeals, setCreateMeals] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [result, setResult] = useState<GlucoseImportResult | null>(null);

  const back = localeHref(locale, "/settings");
  const formatName = t("format.clarity");
  const fileLabelId = useId();

  function pick(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const outcome = await api.importGlucose(spaceId, { text, createMeals });
      setResult(outcome);
      router.refresh();
    } catch (failure) {
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  return (
    <div className={styles.page} data-testid="import">
      <PageHeader
        backHref={back}
        backLabel={settings("back")}
        title={t("title", { format: formatName })}
      />
      <Card>
        <form className={styles.form} onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <p className={styles.lead}>{t("lead", { format: formatName })}</p>
          <div className={styles.field}>
            <span id={fileLabelId}>{t("file", { format: formatName })}</span>
            <div className={styles.filePicker}>
              <label className={styles.fileButton} data-disabled={busy || undefined}>
                <input
                  className={styles.srOnly}
                  name="file"
                  type="file"
                  accept=".csv,text/csv"
                  aria-labelledby={fileLabelId}
                  onChange={pick}
                  disabled={busy}
                />
                {t("chooseFile")}
              </label>
              <span className={styles.fileName} data-testid="file-name">
                {file ? file.name : t("noFile")}
              </span>
            </div>
          </div>
          <label className={styles.radio}>
            <input
              className={styles.checkbox}
              type="checkbox"
              name="createMeals"
              checked={createMeals}
              onChange={(e) => {
                setCreateMeals(e.target.checked);
              }}
              disabled={busy}
            />
            {t("createMeals")}
          </label>
          <Notice>{t("createMealsHint")}</Notice>
          <Notice>{t("timezone", { timezone })}</Notice>
          {error && (
            <Notice tone="sunken" role="alert">
              {errors(error)}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !file}>
              {busy ? t("submitting") : t("submit")}
            </Button>
            <Button variant="secondary" href={back}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      </Card>
      {result && (
        <Card data-testid="import-result">
          <div className={styles.form} role="status">
            <p className={styles.rowTitle}>{t("done")}</p>
            <p>
              {t("readings", { added: result.readings.added, skipped: result.readings.skipped })}
            </p>
            {result.readings.from && result.readings.to && (
              <p className={styles.lead}>
                {t("range", { from: when(result.readings.from), to: when(result.readings.to) })}
              </p>
            )}
            <p>{t("meals", { added: result.meals.added, skipped: result.meals.skipped })}</p>
            <p className={styles.lead}>{t("otherRows", { count: result.otherRows })}</p>
            <p className={styles.lead}>{t("again")}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
