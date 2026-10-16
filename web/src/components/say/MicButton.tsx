"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./say.module.css";

interface Recognition {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;
export function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function MicButton({
  locale,
  onTranscript,
  disabled = false,
}: {
  locale: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("say");
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const browser = window as unknown as {
      SpeechRecognition?: RecognitionConstructor;
      webkitSpeechRecognition?: RecognitionConstructor;
    };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    instance.lang = locale === "da" ? "da-DK" : "en-GB";
    instance.onresult = (event) => {
      onTranscript(
        Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join(" "),
      );
    };
    instance.onend = () => {
      setListening(false);
    };
    instance.onerror = () => {
      setListening(false);
      setFailed(true);
    };
    setRecognition(instance);
    return () => {
      instance.onresult = null;
      instance.onend = null;
      instance.onerror = null;
      instance.abort();
    };
  }, [locale, onTranscript]);
  if (!recognition) return null;
  return (
    <div>
      <button
        type="button"
        className={styles.mic}
        disabled={disabled}
        aria-pressed={listening}
        aria-label={t(listening ? "listening" : "microphone")}
        onClick={() => {
          if (listening) {
            recognition.stop();
            setListening(false);
            return;
          }
          try {
            recognition.start();
            setListening(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        <MicIcon />
      </button>
      <p className={styles.muted}>{t(listening ? "listening" : "voiceNotice")}</p>
      {failed && <p role="status">{t("voiceUnavailable")}</p>}
    </div>
  );
}
