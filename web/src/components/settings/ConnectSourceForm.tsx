"use client";

// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode, GlucoseSourceType } from "@frejsi/shared";
import { DexcomShareRegion } from "@frejsi/shared/schemas/glucose";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { PageHeader } from "./controls";
import { failureCode, settingsApi, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";

export interface ConnectSourceFormProps {
  locale: AppLocale;
  spaceId: string;
  /** The source being connected; the display name is the message `source.<type>.name`. */
  sourceType: GlucoseSourceType;
  region?: DexcomShareRegion;
  api?: SettingsApi;
}

/**
 * "Skift login" (plan task 9; no artboard, design gap): username, password and server region,
 * posted to `/api/spaces/:id/source`. The password lives in this form's state and the request
 * body only; it is never put in the URL, a cookie or a log line. A refusal shows the translated
 * code; success returns to Settings, which then shows the source connected.
 */
export function ConnectSourceForm({
  locale,
  spaceId,
  sourceType,
  region: initialRegion = "eu",
  api = settingsApi(),
}: ConnectSourceFormProps) {
  const t = useTranslations("settings");
  const sources = useTranslations("source");
  const errors = useTranslations("errors.api");
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<DexcomShareRegion>(initialRegion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const back = localeHref(locale, "/settings");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.connectSource(spaceId, { type: "dexcom-share", region, username, password });
      setPassword("");
      router.push(back);
      router.refresh();
    } catch (failure) {
      setError(failureCode(failure));
      setBusy(false);
    }
  }

  return (
    <div className={styles.page} data-testid="connect-source">
      <PageHeader backHref={back} backLabel={t("back")} title={t("connect.title")} />
      <Card>
        <form className={styles.form} onSubmit={(e) => void submit(e)} aria-busy={busy}>
          <p className={styles.lead}>
            <strong>{sources(`${sourceType}.name`)}</strong> · {t("connect.lead")}
          </p>
          <label className={styles.field}>
            {t("connect.username")}
            <input
              className={styles.input}
              name="username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
              }}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            {t("connect.password")}
            <input
              className={styles.input}
              name="password"
              type="password"
              autoComplete="off"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              disabled={busy}
            />
          </label>
          {/* The region options follow the shared contract today (ConnectSourceRequest.region is a
              DexcomShareRegion). When a second GlucoseSource lands, they come from that source
              type's own config schema instead of being fixed here. */}
          <fieldset className={styles.field} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{t("connect.region")}</legend>
            <div className={styles.radios}>
              {DexcomShareRegion.options.map((option) => (
                <label key={option} className={styles.radio}>
                  <input
                    type="radio"
                    name="region"
                    value={option}
                    checked={region === option}
                    onChange={() => {
                      setRegion(option);
                    }}
                    disabled={busy}
                  />
                  {t(`connect.regionOption.${option}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {error && (
            <Notice tone="sunken" role="alert">
              {errors(error)}
            </Notice>
          )}
          <div className={styles.actions}>
            <Button type="submit" disabled={busy}>
              {busy ? t("connect.submitting") : t("connect.submit")}
            </Button>
            <Button variant="secondary" href={back}>
              {t("connect.cancel")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
