"use client";
import type { PhotoEstimate } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { BackButton } from "@/components/ui/BackButton";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import type { AppLocale } from "@/lib/i18n/routing";
import styles from "./estimate.module.css";

export function EstimateView({
  estimate,
  photoDataUrl,
  carers,
  locale,
  simple,
  onBack,
  onAsk,
  sending = false,
  failed = false,
}: {
  estimate: PhotoEstimate;
  photoDataUrl: string;
  carers: string[];
  locale: AppLocale;
  simple: boolean;
  onBack: () => void;
  onAsk: () => void;
  sending?: boolean;
  failed?: boolean;
}) {
  const t = useTranslations("ask");
  const food = useTranslations("foodKit");
  const names = carers.length
    ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(carers)
    : t("adults");
  return (
    <div className={styles.page} data-simple={simple}>
      <header className={styles.header}>
        <BackButton
          onClick={onBack}
          label={t("back")}
          disabled={sending}
          size={simple ? "simple" : "normal"}
        />
        <h1>{t("title")}</h1>
        <span />
      </header>
      {/* A transient user capture; Next's remote image loader must never fetch it. */}
      <img className={styles.photo} src={photoDataUrl} alt={t("photoAlt")} />
      <section className={styles.card} aria-label={t("looksLike")}>
        <div className={styles.row}>
          <h2>{t("looksLike")}</h2>
          <span className={styles.badge}>{t("guess")}</span>
        </div>
        {estimate.items.map((item, index) => (
          <div className={styles.item} key={index}>
            <h3>{item.name}</h3>
            <p>
              {t("amount", { carbs: item.carbs })}
              {item.confidence === "low" ? ` · ${t("uncertain")}` : ""}
            </p>
          </div>
        ))}
        <div className={styles.row}>
          <strong>{t("total")}</strong>
          <strong className={styles.total}>{t("amount", { carbs: estimate.totalCarbs })}</strong>
        </div>
      </section>
      <div className={styles.notice}>
        <Notice>{food("estimateNotice")}</Notice>
      </div>
      {failed && <Notice role="alert">{t("failed")}</Notice>}
      <div className={styles.action}>
        <Button size={simple ? "simple" : "desktop"} disabled={sending} onClick={onAsk}>
          {t(sending ? "sending" : "ask")}
        </Button>
        <p>{carers.length ? t("carers", { carers: names }) : t("noCarers")}</p>
      </div>
    </div>
  );
}
