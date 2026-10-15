"use client";

// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode, SpaceSettings } from "@frejsi/shared";
import { mgdlToMmol, mmolToMgdl } from "@frejsi/shared/glucose/units";
import { GlucoseSourceType, GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import { Locale } from "@frejsi/shared/schemas/settings";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { SourceStatusBanner } from "@/components/shell/SourceStatusBanner";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import type { UserSettingsPatch } from "./contracts";
import { Row, SegmentedControl, Switch } from "./controls";
import type { SettingsData, SettingsPerson } from "./load-settings";
import { formatDay, sameDay } from "./reading-time";
import { failureCode, settingsApi, type SettingsApi } from "./settings-client";
import styles from "./settings.module.css";

export interface SettingsScreenProps {
  locale: AppLocale;
  data: SettingsData;
  /** The server's clock, ISO, for "sidste måling i dag"; the same on the server and after hydration. */
  now: string;
  api?: SettingsApi;
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * Indstillinger (plan task 9): the phone list and the desktop sections from one component. The
 * space section (source, unit, target range) exists only when `data.space` does, which the loader
 * gives owners and carers; what a person may change is decided by the routes, and the controls
 * only mirror that so nobody is offered a switch that would be refused.
 */
export function SettingsScreen({ locale, data, now, api = settingsApi() }: SettingsScreenProps) {
  const t = useTranslations("settings");
  const sources = useTranslations("source");
  const accents = useTranslations("accent");
  const locales = useTranslations("locale");
  const errors = useTranslations("errors.api");
  const app = useTranslations("app");
  const router = useRouter();

  const [space, setSpace] = useState(data.space);
  const [people, setPeople] = useState(data.people);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorCode | null>(null);

  const isOwner = data.role === "owner";
  const me = people.find((p) => p.userId === data.me.userId) ?? data.me;
  const source = data.source;
  const settingsHref = (path: string) => localeHref(locale, `/settings${path}`);

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (failure) {
      setError(failureCode(failure));
    } finally {
      setBusy(false);
    }
  }

  const changeUnit = (glucoseUnit: GlucoseUnit) =>
    attempt(async () => {
      setSpace(await api.patchSpace(data.spaceId, { glucoseUnit }));
    });

  const saveRange = (targetLow: number, targetHigh: number) =>
    attempt(async () => {
      setSpace(await api.patchSpace(data.spaceId, { targetLow, targetHigh }));
    });

  const changePerson = (person: SettingsPerson, patch: UserSettingsPatch) =>
    attempt(async () => {
      const isMe = person.userId === me.userId;
      const next = await api.patchPerson(data.spaceId, person.userId, isMe, patch);
      setPeople((current) =>
        current.map((p) => (p.userId === person.userId ? { ...p, ...next } : p)),
      );
      // One's own language also changes the URL's locale; the shell re-renders on the refresh.
      if (isMe && patch.locale !== undefined && patch.locale !== locale) {
        router.replace(localeHref(patch.locale, "/settings"));
      }
    });

  const sourceName = source?.type ? sources(`${source.type}.name`) : null;
  const phoneSourceText = describePhone();
  const desktopSourceText = describeDesktop();

  function describePhone(): string {
    if (!source || !sourceName) return t("source.notConfigured");
    if (source.status === "disconnected") return t("source.rowDisconnected", { source: sourceName });
    if (source.status === "connected" && source.lastReadingAt) {
      const time = formatClock(new Date(source.lastReadingAt), data.timezone);
      return t("source.rowConnected", { source: sourceName, time });
    }
    if (source.status === "connected") return t("source.rowConnectedNoReading", { source: sourceName });
    return t("source.notConfigured");
  }

  function describeDesktop(): string {
    if (!source?.type || !source.region) return t("source.notConfigured");
    const region = t(`source.region.${source.region}`);
    if (source.status === "disconnected") return t("source.cardDisconnected", { region });
    if (source.status !== "connected") return t("source.notConfigured");
    if (!source.lastReadingAt) return t("source.cardConnectedNoReading", { region });
    const at = new Date(source.lastReadingAt);
    const time = formatClock(at, data.timezone);
    const when = sameDay(at, new Date(now), data.timezone)
      ? t("source.today", { time })
      : t("source.onDate", { date: formatDay(at, data.timezone, locale), time });
    return t("source.cardConnected", { when, region });
  }

  const simplePeople = people.filter((p) => p.role !== "viewer");

  return (
    <div className={styles.page} data-testid="settings" aria-busy={busy}>
      <header className={styles.head}>
        <h1>{t("title")}</h1>
        <p className={styles.subtitle}>
          {isOwner ? t("subtitleOwner", { space: data.spaceName }) : t("subtitleMember")}
        </p>
      </header>

      {source && (
        <SourceStatusBanner
          status={source.status}
          since={source.since}
          sourceType={source.type}
          timeZone={data.timezone}
        />
      )}
      {error && (
        <Notice tone="sunken" role="alert">
          {errors(error)}
        </Notice>
      )}

      <div className={styles.body}>
        <nav className={styles.sectionNav} aria-label={t("title")}>
          {space && (
            <a className={styles.navItem} href="#source">
              {t("sections.source")}
            </a>
          )}
          <a className={styles.navItem} href="#ai">
            {t("sections.ai")}
          </a>
          <a className={styles.navItem} href="#unit-language">
            {t("sections.unitAndLanguage")}
          </a>
          <a className={styles.navItem} href="#simple-mode">
            {t("sections.simpleMode")}
          </a>
          <a className={styles.navItem} href={settingsHref("/colour")}>
            {t("sections.colour")}
          </a>
          <a className={styles.navItem} href="#data">
            {t("sections.data")}
          </a>
        </nav>

        <div className={styles.sections}>
          {space && source && (
            <section id="source" className={styles.section} data-testid="source-section">
              <h2 className={styles.sectionTitle}>{t("sections.source")}</h2>
              <p className={cx(styles.lead, styles.desktopOnly)}>
                {t("source.lead", { subject: data.subjectName })}
              </p>
              <Card className={cx(styles.list, styles.phoneOnly)}>
                <Row
                  title={sourceName ?? t("sections.source")}
                  sub={phoneSourceText}
                  testId="source-row"
                  {...(isOwner ? { href: settingsHref("/source") } : {})}
                />
                <Row title={t("source.nightscout")} sub={t("comingLater")} />
                <Row title={t("source.manual")} sub={t("comingLater")} />
              </Card>
              <div className={cx(styles.sourceCards, styles.desktopOnly)}>
                {GlucoseSourceType.options.map((type) => {
                  const selected = type === source.type;
                  return (
                    <div
                      key={type}
                      className={styles.sourceCard}
                      data-selected={selected}
                      data-testid={selected ? "source-card" : undefined}
                    >
                      <span className={styles.cardText}>
                        <span className={styles.cardTitle}>{sources(`${type}.name`)}</span>
                        <span className={styles.cardSub}>
                          {selected ? desktopSourceText : t("source.notConfigured")}
                        </span>
                      </span>
                      {isOwner && (
                        <Button variant="secondary" href={settingsHref("/source")}>
                          {selected ? t("source.changeLogin") : t("source.connect")}
                        </Button>
                      )}
                    </div>
                  );
                })}
                <div className={styles.sourceCard}>
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>{t("source.nightscout")}</span>
                    <span className={styles.cardSub}>{t("comingLater")}</span>
                  </span>
                </div>
                <div className={styles.sourceCard}>
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>{t("source.manual")}</span>
                    <span className={styles.cardSub}>{t("comingLater")}</span>
                  </span>
                </div>
                {sourceName && <Notice>{t("source.vaultNote", { source: sourceName })}</Notice>}
              </div>
            </section>
          )}

          <section id="ai" className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("sections.ai")}</h2>
            <Card className={styles.list}>
              <Row title={t("ai.lead")} sub={t("comingLater")} />
            </Card>
          </section>

          <section id="unit-language" className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("sections.unitAndLanguage")}</h2>
            <Card className={styles.list}>
              {space && (
                <Row
                  title={t("unit.label")}
                  control={
                    <SegmentedControl
                      label={t("unit.labelDesktop")}
                      value={space.glucoseUnit}
                      options={GlucoseUnit.options.map((unit) => ({
                        value: unit,
                        label: t(`unit.${unit}`),
                      }))}
                      onChange={(unit) => void changeUnit(unit)}
                      disabled={!isOwner || busy}
                    />
                  }
                />
              )}
              <Row
                title={t("language.label")}
                control={
                  <SegmentedControl
                    label={t("language.label")}
                    value={me.locale}
                    options={Locale.options.map((code) => ({ value: code, label: locales(code) }))}
                    onChange={(code) => void changePerson(me, { locale: code })}
                    disabled={busy}
                  />
                }
              />
              {space && isOwner && (
                <TargetRange
                  space={space}
                  disabled={busy}
                  onSave={(low, high) => void saveRange(low, high)}
                />
              )}
            </Card>
          </section>

          <section id="simple-mode" className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("sections.simpleMode")}</h2>
            <p className={styles.lead}>{isOwner ? t("simpleMode.leadDesktop") : t("simpleMode.lead")}</p>
            <Card className={styles.list}>
              {simplePeople.map((person) => {
                const isMe = person.userId === me.userId;
                const name = isMe ? t("simpleMode.you", { name: person.name }) : person.name;
                return (
                  <div key={person.userId} className={styles.person} data-testid="person-row">
                    <Avatar name={person.name} size={44} tone="member" />
                    <span className={styles.personText}>
                      <span className={styles.personName}>{name}</span>
                      {isOwner && !isMe && (
                        <SegmentedControl
                          size="small"
                          label={t("simpleMode.languageFor", { name: person.name })}
                          value={person.locale}
                          options={Locale.options.map((code) => ({
                            value: code,
                            label: locales(code),
                          }))}
                          onChange={(code) => void changePerson(person, { locale: code })}
                          disabled={busy}
                        />
                      )}
                    </span>
                    <Switch
                      label={t("simpleMode.toggle", { name: person.name })}
                      checked={person.simpleMode}
                      onChange={(simpleMode) => void changePerson(person, { simpleMode })}
                      disabled={busy}
                    />
                  </div>
                );
              })}
              <Row
                title={t("colour.row")}
                sub={accents(me.accent)}
                href={settingsHref("/colour")}
                testId="colour-row"
              />
            </Card>
          </section>

          <section id="data" className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("sections.data")}</h2>
            <Card className={styles.list}>
              <Row title={t("data.lead")} sub={t("comingLater")} />
            </Card>
          </section>
        </div>
      </div>

      <p className={cx(styles.footer, styles.phoneOnly)}>{app("footer")}</p>
    </div>
  );
}

/**
 * The target range as drawn on Indstillinger-Desktop: two small inputs in the space's unit and a
 * save. Values are stored in mmol (plan §3); an mg/dL space converts both ways here.
 */
function TargetRange({
  space,
  disabled,
  onSave,
}: {
  space: SpaceSettings;
  disabled: boolean;
  onSave: (targetLow: number, targetHigh: number) => void;
}) {
  const t = useTranslations("settings");
  const unit = space.glucoseUnit;
  const shown = (mmol: number) => (unit === "mgdl" ? String(mmolToMgdl(mmol)) : mmol.toFixed(1));
  const [low, setLow] = useState(shown(space.targetLow));
  const [high, setHigh] = useState(shown(space.targetHigh));
  const [shownFor, setShownFor] = useState(`${unit}:${space.targetLow}:${space.targetHigh}`);
  const key = `${unit}:${space.targetLow}:${space.targetHigh}`;
  if (key !== shownFor) {
    setShownFor(key);
    setLow(shown(space.targetLow));
    setHigh(shown(space.targetHigh));
  }

  const toMmol = (text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    return unit === "mgdl" ? mgdlToMmol(value) : Math.round(value * 10) / 10;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const targetLow = toMmol(low);
    const targetHigh = toMmol(high);
    if (targetLow === null || targetHigh === null) return;
    onSave(targetLow, targetHigh);
  };

  return (
    <form className={cx(styles.range, styles.desktopOnly)} onSubmit={submit} aria-label={t("targetRange.label")}>
      <span className={styles.rowTitle}>{t("targetRange.label")}</span>
      <div className={styles.rangeFields}>
        <label className={styles.field}>
          {t("targetRange.low")}
          <input
            className={cx(styles.input, styles.rangeInput)}
            type="number"
            inputMode="decimal"
            step={unit === "mgdl" ? 1 : 0.1}
            min={0}
            max={unit === "mgdl" ? 700 : 40}
            value={low}
            onChange={(e) => {
              setLow(e.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <span className={styles.rangeDash} aria-hidden="true">
          –
        </span>
        <label className={styles.field}>
          {t("targetRange.high")}
          <input
            className={cx(styles.input, styles.rangeInput)}
            type="number"
            inputMode="decimal"
            step={unit === "mgdl" ? 1 : 0.1}
            min={0}
            max={unit === "mgdl" ? 700 : 40}
            value={high}
            onChange={(e) => {
              setHigh(e.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={disabled}>
          {t("targetRange.save")}
        </Button>
      </div>
      <span className={styles.rowSub}>{t("targetRange.note", { unit: t(`unit.${unit}`) })}</span>
    </form>
  );
}
