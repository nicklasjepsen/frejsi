"use client";

// Values come from the pure modules by path, never from the shared index (see ConnectSourceForm).
import type { ApiErrorCode } from "@frejsi/shared";
import type { PumpSettingsView } from "@frejsi/shared/schemas/pump";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ageOf } from "@/components/glucose/format";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { formatClock } from "@/lib/i18n/time";
import type { AppLocale } from "@/lib/i18n/routing";

import { Row } from "./controls";
import { PumpSourceForm } from "./PumpSourceForm";
import {
  pumpSourceApi,
  type ConnectedPumpSettings,
  type PumpSourceApi,
} from "./pump-source-client";
import { formatDay, sameDay } from "./reading-time";
import { useServerState } from "./server-state";
import { failureCode } from "./settings-client";
import styles from "./settings.module.css";

/**
 * The lines Settings writes about the pump record: the card's status and newest-record lines and
 * the phone row. Every word is a `pumpSettings` message; the times are the space's clock.
 */
export function usePumpText(
  pump: PumpSettingsView,
  timezone: string,
  now: string,
  locale: AppLocale,
) {
  const t = useTranslations("pumpSettings");
  const timeOf = (iso: string) => formatClock(new Date(iso), timezone);
  const whenOf = (iso: string) => {
    const at = new Date(iso);
    const time = formatClock(at, timezone);
    return sameDay(at, new Date(now), timezone)
      ? time
      : t("onDate", { date: formatDay(at, timezone, locale), time });
  };
  const ageText = (iso: string) => {
    const age = ageOf(iso, new Date(now));
    if (age.kind === "justNow") return t("age.justNow");
    if (age.kind === "minutes") return t("age.minutes", { minutes: age.minutes });
    if (age.kind === "overADay") return t("age.overADay");
    return age.minutes === 0
      ? t("age.wholeHours", { hours: age.hours })
      : t("age.hours", { hours: age.hours, minutes: age.minutes });
  };
  const configured = pump.configured && pump.status !== "not-configured";

  /** "Ikke forbundet", "Forbundet" or "Forbindelsen svigter siden 14:05". */
  function status(): string {
    if (!configured) return t("status.notConfigured");
    if (pump.status === "disconnected") {
      return pump.since
        ? t("status.disconnected", { time: whenOf(pump.since) })
        : t("status.disconnectedNoTime");
    }
    return t("status.connected");
  }

  /** "Senest fra pumpen: 11:58 · for 1 t 10 min siden", or null before a connection. */
  function latest(): string | null {
    if (!configured) return null;
    if (!pump.lastPumpAt) return t("nothingYet");
    return t("latest", { when: whenOf(pump.lastPumpAt), age: ageText(pump.lastPumpAt) });
  }

  /** The "Pumpehistorik" row on the phone. */
  function phoneRow(): string {
    if (!configured || pump.status === "disconnected") return status();
    return pump.lastPumpAt
      ? t("row.connected", { time: timeOf(pump.lastPumpAt) })
      : t("row.connectedNothing");
  }

  return { configured, status, latest, phoneRow };
}

/** The phone's "Pumpehistorik" row in Settings; it opens `settings/pump` for owners and carers. */
export function PumpRow({
  pump,
  timezone,
  now,
  locale,
  href,
}: {
  pump: PumpSettingsView;
  timezone: string;
  now: string;
  locale: AppLocale;
  href: string;
}) {
  const t = useTranslations("pumpSettings");
  const text = usePumpText(pump, timezone, now, locale);
  return <Row title={t("title")} sub={text.phoneRow()} href={href} testId="pump-row" />;
}

export interface PumpSourceCardProps {
  locale: AppLocale;
  spaceId: string;
  pump: PumpSettingsView;
  timezone: string;
  /** The server's clock, ISO, for the age of the newest record. */
  now: string;
  /** Owners connect and disconnect; carers see the status and nothing to press. */
  owner: boolean;
  api?: PumpSourceApi;
  layout?: "card" | "page";
}

/**
 * "Pumpehistorik" (v0.7.0 plan §9 item 5; no artboard, built as a `SourceCards` card): the pump
 * record's own connection, beside the glucose source and separate from it. The status, the newest
 * record with its time and age (Tandem's upload lags up to an hour), and for an owner the connect
 * form and "Afbryd". Viewers and simpleMode sessions never get here: the loader gives them no
 * `pump` and the route refuses them.
 */
export function PumpSourceCard({
  locale,
  spaceId,
  pump,
  timezone,
  now,
  owner,
  api = pumpSourceApi(),
  layout = "card",
}: PumpSourceCardProps) {
  const t = useTranslations("pumpSettings");
  const errors = useTranslations("errors.api");
  const router = useRouter();
  const [view, update] = useServerState(pump, (p) => p);
  const text = usePumpText(view, timezone, now, locale);
  const [formOpen, setFormOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [noRecent, setNoRecent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const size = layout === "page" ? "phone" : "desktop";

  const connected = ({ recentBoluses, ...next }: ConnectedPumpSettings) => {
    update(() => next);
    setFormOpen(false);
    setNoRecent(recentBoluses === 0);
    router.refresh();
  };

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.disconnect(spaceId);
      update(() => next);
      setAsking(false);
      setNoRecent(false);
      router.refresh();
    } catch (failure) {
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  const latest = text.latest();

  return (
    <div className={styles.sourceCards} data-testid="pump-card" data-layout={layout}>
      <div className={styles.sourceCard} data-layout={layout === "page" ? "radio" : "cards"}>
        <div className={styles.cardText}>
          <h3 className={styles.cardTitle}>{t("title")}</h3>
          <span className={styles.cardSub} data-testid="pump-status">
            {text.status()}
          </span>
          {latest && (
            <span className={styles.cardSub} data-testid="pump-latest">
              {latest}
            </span>
          )}
        </div>
        {owner && !formOpen && (
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size={size}
              disabled={busy}
              onClick={() => {
                setError(null);
                setAsking(false);
                setFormOpen(true);
              }}
            >
              {text.configured ? t("changeAccess") : t("connect")}
            </Button>
            {text.configured && (
              <Button
                variant="secondary"
                size={size}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setAsking(true);
                }}
              >
                {t("disconnect")}
              </Button>
            )}
          </div>
        )}
      </div>
      {owner && formOpen && (
        <PumpSourceForm
          spaceId={spaceId}
          api={api}
          onConnected={connected}
          onCancel={() => {
            setFormOpen(false);
          }}
        />
      )}
      {asking && (
        <div
          className={styles.confirm}
          role="alertdialog"
          aria-label={t("disconnect")}
          data-testid="pump-disconnect-confirm"
        >
          <p>{t("disconnectConfirm")}</p>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => void disconnect()}>
              {t("disconnectYes")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setAsking(false);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {noRecent && (
        <Notice tone="sunken" role="status" data-testid="pump-no-recent">
          {t("noRecentBoluses")}
        </Notice>
      )}
      {error && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}
      <p className={styles.lead}>{t("lag")}</p>
    </div>
  );
}
