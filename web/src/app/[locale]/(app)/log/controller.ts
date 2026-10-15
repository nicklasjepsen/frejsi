"use client";
// State and actions of the log screen, shared by the phone and desktop layouts. Every write goes
// through the foods and meals routes (components/meal/api.ts), so every write emits; nothing in
// log/ imports Prisma (log.test.ts asserts it).
import type {
  CreateFoodRequest,
  FoodView,
  LookupResponse,
  LookupResult,
} from "@frejsi/shared/schemas/food";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createManualFood,
  createMeal,
  listFoods,
  lookupBarcode,
  lookupText,
  pickCandidate,
} from "@/components/meal/api";
import {
  addFood,
  chooseGrams,
  choosePortion,
  clearChoice,
  emptyDraft,
  isComplete,
  removeItem,
  toMealRequest,
  totalCarbs,
  type MealDraft,
} from "@/components/meal/draft";
import { isLibraryFood } from "@/components/meal/LookupResults";
import { asTypedBarcode } from "@/lib/barcode/detect";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

export type PhoneView = "entry" | "library" | "scan" | "typeBarcode" | "manual" | "confirm";

/** Debounce for the as-you-type lookup (library, cache and local sources only). */
export const TYPE_DEBOUNCE_MS = 250;

export interface LogControllerOptions {
  spaceId: string;
  locale: AppLocale;
  initialQuery?: string | undefined;
  initialBarcode?: string | undefined;
  /** Called after a food lands in the meal (the phone opens the confirm screen). */
  onAdded?: () => void;
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useLogController({
  spaceId,
  locale,
  initialQuery,
  initialBarcode,
  onAdded,
}: LogControllerOptions) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery ?? "");
  /** The latest answer and the query (or barcode) it answers; a stale answer is never shown. */
  const [answered, setAnswered] = useState<{ key: string; response: LookupResponse } | null>(null);
  /** The query whose all-sources (remote) answer is on screen; Enter then adds instead of searching. */
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [pickFailed, setPickFailed] = useState(false);
  const [favourites, setFavourites] = useState<FoodView[]>([]);
  const [recent, setRecent] = useState<FoodView[]>([]);
  const [library, setLibrary] = useState<FoodView[] | null>(null);
  const [draft, setDraft] = useState<MealDraft>(emptyDraft);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [manual, setManual] = useState<{ name: string; barcode?: string } | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualFailed, setManualFailed] = useState(false);
  const [photo, setPhoto] = useState<Uint8Array | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [barcodeInvalid, setBarcodeInvalid] = useState(false);
  const abort = useRef<AbortController | null>(null);
  /** The query an Enter is searching every source for; a pending as-you-type lookup yields to it. */
  const remoteFor = useRef<string | null>(null);
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;

  const runLookup = useCallback(
    async (key: string, run: (signal: AbortSignal) => Promise<LookupResponse>) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const answer = await run(controller.signal);
        if (controller.signal.aborted) return null;
        setLookupFailed(false);
        setAnswered({ key, response: answer });
        return answer;
      } catch (error) {
        if (controller.signal.aborted) return null;
        if (!(error instanceof DOMException && error.name === "AbortError")) setLookupFailed(true);
        return null;
      }
    },
    [],
  );

  const addToMeal = useCallback((food: FoodView) => {
    setDraft((current) => {
      const next = addFood(current, food);
      setActiveKey(next.items.at(-1)?.key ?? null);
      return next;
    });
    setSaveFailed(false);
    onAddedRef.current?.();
  }, []);

  const pick = useCallback(
    async (result: LookupResult) => {
      setPickFailed(false);
      if (isLibraryFood(result.food)) {
        addToMeal(result.food);
        return;
      }
      try {
        addToMeal(await pickCandidate(spaceId, result.food));
      } catch {
        setPickFailed(true);
      }
    },
    [addToMeal, spaceId],
  );

  const openManual = useCallback((name: string, barcode?: string) => {
    setManualFailed(false);
    setManual(barcode ? { name, barcode } : { name });
  }, []);

  const runBarcode = useCallback(
    async (code: string, key: string = code) => {
      setBarcodeInvalid(false);
      const answer = await runLookup(key, (signal) => lookupBarcode(spaceId, code, signal));
      if (!answer) return "failed" as const;
      const first = answer.results[0];
      if (first) {
        await pick(first);
        return "found" as const;
      }
      // An unknown barcode lands on "Jeg kender tallet selv" with the barcode prefilled.
      openManual(answer.manual.name ?? "", answer.manual.barcode ?? code);
      return "unknown" as const;
    },
    [openManual, pick, runLookup, spaceId],
  );

  /** A raw scanned or typed value: checksums are validated before any lookup. */
  const submitBarcode = useCallback(
    async (raw: string) => {
      const code = asTypedBarcode(raw);
      if (!code) {
        setBarcodeInvalid(true);
        return "invalid" as const;
      }
      return runBarcode(code);
    },
    [runBarcode],
  );

  /** Enter or the search button: a valid barcode looks up the barcode, else every source. */
  const submit = useCallback(
    async (value: string) => {
      const code = asTypedBarcode(value);
      if (code) return runBarcode(code, value.trim());
      const q = value.trim();
      if (!q) return "failed" as const;
      remoteFor.current = q;
      const answer = await runLookup(q, (signal) => lookupText(spaceId, q, true, signal));
      if (answer) setSubmitted(q);
      return answer ? ("searched" as const) : ("failed" as const);
    },
    [runBarcode, runLookup, spaceId],
  );

  // As you type: library, cache and local sources (remote: false), debounced.
  useEffect(() => {
    const q = query.trim();
    if (remoteFor.current !== q) remoteFor.current = null;
    if (!q) {
      abort.current?.abort();
      setAnswered(null);
      setSubmitted(null);
      return;
    }
    if (submitted === q || asTypedBarcode(q)) return;
    const timer = setTimeout(() => {
      if (remoteFor.current === q) return;
      void runLookup(q, (signal) => lookupText(spaceId, q, false, signal));
    }, TYPE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, runLookup, spaceId, submitted]);

  // Favourites and recent for the entry screen; both hide while empty (design gap 6).
  useEffect(() => {
    let live = true;
    void listFoods(spaceId, "favourites")
      .then((foods) => {
        if (live) setFavourites(foods);
      })
      .catch(() => undefined);
    void listFoods(spaceId, "recent")
      .then((foods) => {
        if (live) setRecent(foods);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [spaceId]);

  // ?q= and ?barcode= from the Now header run the lookup on load.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialBarcode) void submitBarcode(initialBarcode);
    else if (initialQuery?.trim()) void submit(initialQuery);
  }, [initialBarcode, initialQuery, submit, submitBarcode]);

  const loadLibrary = useCallback(() => {
    if (library) return;
    listFoods(spaceId, "all")
      .then(setLibrary)
      .catch(() => {
        setLibrary([]);
      });
  }, [library, spaceId]);

  const createManual = useCallback(
    async (request: CreateFoodRequest) => {
      setManualBusy(true);
      setManualFailed(false);
      try {
        const food = await createManualFood(spaceId, request);
        setManual(null);
        addToMeal(food);
      } catch {
        setManualFailed(true);
      } finally {
        setManualBusy(false);
      }
    },
    [addToMeal, spaceId],
  );

  const goNow = useCallback(() => {
    router.push(localeHref(locale, "/now"));
  }, [locale, router]);

  const save = useCallback(async () => {
    if (!isComplete(draft) || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const request = toMealRequest(draft, photo ? bytesToDataUrl(photo) : null);
      await createMeal(spaceId, request);
      goNow();
    } catch {
      // The meal stays on screen, as it was, so nothing has to be typed again.
      setSaveFailed(true);
      setSaving(false);
    }
  }, [draft, goNow, photo, saving, spaceId]);

  return {
    query,
    /** Typing starts a new search: a manual form left open on desktop closes. */
    setQuery: (value: string) => {
      setManual(null);
      setQuery(value);
    },
    response: answered?.key === query.trim() ? answered.response : null,
    submitted,
    lookupFailed,
    pickFailed,
    favourites,
    recent,
    library,
    loadLibrary,
    draft,
    total: totalCarbs(draft),
    complete: isComplete(draft),
    activeKey,
    setActiveKey,
    manual,
    openManual,
    closeManual: () => {
      setManual(null);
    },
    manualBusy,
    manualFailed,
    createManual,
    barcodeInvalid,
    submit,
    submitBarcode,
    pick,
    addToMeal,
    choosePortion: (key: string, index: number) => {
      setDraft((d) => choosePortion(d, key, index));
    },
    chooseGrams: (key: string, grams: number | null) => {
      setDraft((d) => (grams === null ? clearChoice(d, key) : chooseGrams(d, key, grams)));
    },
    removeItem: (key: string) => {
      setDraft((d) => removeItem(d, key));
    },
    setTs: (ts: string) => {
      setDraft((d) => ({ ...d, ts }));
    },
    tapBolus: () => {
      setDraft((d) => ({ ...d, bolusTs: new Date().toISOString() }));
    },
    undoBolus: () => {
      setDraft((d) => ({ ...d, bolusTs: null }));
    },
    canUndoBolus: draft.bolusTs !== null,
    photo,
    setPhoto,
    save,
    saving,
    saveFailed,
    goNow,
  };
}

export type LogController = ReturnType<typeof useLogController>;
