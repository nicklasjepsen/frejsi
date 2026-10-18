"use client";

// Values come from the pure modules by path, never from the shared index (see ConnectSourceForm).
import type { ApiErrorCode } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

import { SegmentedControl } from "./controls";
import {
  pumpSourceApi,
  type ConnectedPumpSettings,
  type PumpSourceApi,
} from "./pump-source-client";
import { failureCode } from "./settings-client";
import styles from "./settings.module.css";

export interface PumpSourceFormProps {
  spaceId: string;
  api?: PumpSourceApi;
  /** The route's answer after a working connect, with `recentBoluses` when the function could tell. */
  onConnected: (settings: ConnectedPumpSettings) => void;
  onCancel: () => void;
}

/**
 * "Forbind pumpehistorik" (v0.7.0 plan §9 item 5): the Nightscout half of `ConnectSourceForm`, an
 * address and a read-only token or API secret, posted to `/api/spaces/:id/pump-source`. The secret
 * lives in this form's state and the request body only, and is emptied after every answer; it is
 * never put in the URL, a cookie or a log line.
 */
export function PumpSourceForm({
  spaceId,
  api = pumpSourceApi(),
  onConnected,
  onCancel,
}: PumpSourceFormProps) {
  const t = useTranslations("pumpSettings");
  const connect = useTranslations("settings.connect.nightscout");
  const errors = useTranslations("errors.api");

  const [url, setUrl] = useState("");
  const [secretKind, setSecretKind] = useState<"token" | "apiSecret">("token");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || !secret) return;
    setBusy(true);
    setError(null);
    try {
      const connected = await api.connect(spaceId, {
        type: "nightscout",
        url: url.trim(),
        [secretKind]: secret,
      });
      setSecret("");
      setBusy(false);
      onConnected(connected);
    } catch (failure) {
      setSecret("");
      setError(failureCode(failure));
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
      aria-labelledby="pump-form-title"
      data-testid="pump-form"
    >
      <h3 id="pump-form-title" className={styles.cardTitle}>
        {t("form.title")}
      </h3>
      <p className={styles.lead}>{t("form.lead")}</p>
      <label className={styles.field}>
        {connect("url")}
        <input
          className={styles.input}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder={connect("urlPlaceholder")}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
          disabled={busy}
        />
      </label>
      <SegmentedControl
        label={connect("secretKind")}
        value={secretKind}
        options={[
          { value: "token", label: connect("token") },
          { value: "apiSecret", label: connect("apiSecret") },
        ]}
        onChange={setSecretKind}
        disabled={busy}
      />
      <label className={styles.field}>
        {connect(secretKind)}
        <input
          className={styles.input}
          name="secret"
          type="password"
          autoComplete="off"
          required
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
          }}
          disabled={busy}
        />
        {error === "source-bad-credentials" && (
          <span role="alert" className={styles.fieldError}>
            {connect("badCredentials")}
          </span>
        )}
      </label>
      {error && error !== "source-bad-credentials" && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}
      <p className={styles.lead}>{t("vaultNote")}</p>
      <div className={styles.actions}>
        <Button type="submit" disabled={busy}>
          {busy ? t("form.submitting") : t("form.submit")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
