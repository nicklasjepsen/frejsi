"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { askEstimate } from "./api";
import { getPendingEstimate, clearPendingEstimate, type PendingEstimate } from "./pending";
import { useEstimateStatus } from "./useEstimateStatus";
import { EstimateCapture } from "./EstimateCapture";
import { EstimateView } from "./EstimateView";
import styles from "./estimate.module.css";

export function AskFlow({
  spaceId,
  locale,
  simple,
}: {
  spaceId: string;
  locale: AppLocale;
  simple: boolean;
}) {
  const t = useTranslations("ask");
  const router = useRouter();
  const status = useEstimateStatus(spaceId);
  const [pending, setPending] = useState<PendingEstimate | null>(() => getPendingEstimate(spaceId));
  const [unavailable, setUnavailable] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const carers = status?.carers ?? [];
  const names = carers.length
    ? new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(carers)
    : t("adults");
  async function ask() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailed(false);
    try {
      await askEstimate(spaceId, pending.estimate, pending.photoDataUrl);
      clearPendingEstimate();
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  // Let assistive technology announce confirmation before navigating away.
  if (sent)
    return (
      <Sent
        message={carers.length ? t("sent", { carers: names }) : t("saved")}
        onDone={() => {
          router.push(localeHref(locale, "/now"));
        }}
      />
    );
  // A captured result can still be saved after its vision call used the last call of the day.
  if (pending)
    return (
      <EstimateView
        {...pending}
        carers={carers}
        locale={locale}
        simple={simple}
        sending={sending}
        failed={failed}
        onAsk={() => void ask()}
        onBack={() => {
          clearPendingEstimate();
          router.push(localeHref(locale, "/eat"));
        }}
      />
    );
  if (!status) return <div aria-busy="true" />;
  if (!status.available || unavailable) return <Notice>{t("fallback", { carers: names })}</Notice>;
  return (
    <div className={styles.page} data-simple={simple}>
      <EstimateCapture
        spaceId={spaceId}
        simple={simple}
        onUnavailable={() => {
          setUnavailable(true);
        }}
        onEstimate={(estimate, photoDataUrl) => {
          setPending({ spaceId, estimate, photoDataUrl });
        }}
      />
    </div>
  );
}

function Sent({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [onDone]);
  return <p role="status">{message}</p>;
}
