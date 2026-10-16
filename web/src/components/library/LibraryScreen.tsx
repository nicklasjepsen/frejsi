"use client";
import type { FoodView } from "@frejsi/shared/schemas/food";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { FoodPhoto, SearchField } from "@/components/food";
import {
  Badge,
  Button,
  DataTable,
  ListRow,
  Notice,
  PageHeader,
  type DataColumn,
} from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { libraryApi, type LibraryFilter } from "./api-client";
import { BatchBar } from "./BatchBar";
import { EditPanel } from "./EditPanel";
import { useFoodText } from "./format";
import { LibraryFilters } from "./LibraryFilters";
import styles from "./library.module.css";
import { useLibrary, type LibraryState } from "./useLibrary";
import { VerifyCircle } from "./VerifyCircle";

export interface LibraryScreenProps {
  spaceId: string;
  locale: AppLocale;
  initialFilter?: LibraryFilter;
}

/**
 * Mad / Bibliotek (Bibliotek-Telefon, Bibliotek-Desktop). Phone and desktop are both in the DOM
 * and CSS shows one, as the shell does. Everything is read through `GET foods` and written only
 * through the foods routes (task 4), whose services emit.
 */
export function LibraryScreen({ spaceId, locale, initialFilter = "all" }: LibraryScreenProps) {
  const library = useLibrary(spaceId, initialFilter);
  const [verifying, setVerifying] = useState<ReadonlySet<string>>(new Set());
  const [writeFailed, setWriteFailed] = useState(false);

  const verify = useCallback(
    async (ids: string[]) => {
      const pending = ids.filter((id) => !library.foods.find((food) => food.id === id)?.verified);
      if (pending.length === 0) return true;
      setVerifying((current) => new Set([...current, ...pending]));
      setWriteFailed(false);
      try {
        await libraryApi.verify(spaceId, pending);
        library.markVerified(pending);
        return true;
      } catch {
        setWriteFailed(true);
        return false;
      } finally {
        setVerifying((current) => new Set([...current].filter((id) => !pending.includes(id))));
      }
    },
    [library, spaceId],
  );

  return (
    <div className={styles.page}>
      <PhoneLibrary
        library={library}
        locale={locale}
        verifying={verifying}
        writeFailed={writeFailed}
        onVerify={(id) => {
          void verify([id]);
        }}
      />
      <DesktopLibrary
        library={library}
        spaceId={spaceId}
        verify={verify}
        busy={verifying.size > 0}
        writeFailed={writeFailed}
        setWriteFailed={setWriteFailed}
      />
    </div>
  );
}

function ListState({ library, layout }: { library: LibraryState; layout: "phone" | "desktop" }) {
  const t = useTranslations("library");
  if (library.status === "loading") return <p className={styles.muted} aria-busy="true" />;
  if (library.status === "error")
    return (
      <div className={styles.state} role="alert">
        <p>{t("loadFailed")}</p>
        <Button variant="secondary" size={layout} onClick={library.reload}>
          {t("retry")}
        </Button>
      </div>
    );
  if (library.foods.length > 0) return null;
  if (library.counts?.all === 0 || (library.filter === "all" && !library.query.trim()))
    return (
      <div className={styles.state} data-testid="library-empty">
        <h2>{t("empty.title")}</h2>
        <p>{t("empty.body")}</p>
      </div>
    );
  return <Notice>{t("noMatches")}</Notice>;
}

function PhoneLibrary({
  library,
  locale,
  verifying,
  writeFailed,
  onVerify,
}: {
  library: LibraryState;
  locale: AppLocale;
  verifying: ReadonlySet<string>;
  writeFailed: boolean;
  onVerify: (id: string) => void;
}) {
  const t = useTranslations("library");
  const text = useFoodText();
  return (
    <section className={styles.phone} data-testid="library-phone">
      <PageHeader
        title={t("title")}
        trailing={
          <Link
            href={localeHref(locale, "/library/new")}
            className={styles.addLink}
            aria-label={t("newFood")}
          >
            <span aria-hidden="true">+</span>
          </Link>
        }
      />
      <SearchField
        label={t("search")}
        placeholder={t("search")}
        value={library.query}
        onChange={library.setQuery}
        onSubmit={library.submitQuery}
      />
      <div className={styles.chipScroll}>
        <LibraryFilters
          layout="phone"
          value={library.filter}
          onChange={library.setFilter}
          origins={library.origins}
          unverified={library.counts?.unverified ?? 0}
        />
      </div>
      {writeFailed && (
        <p role="alert" className={styles.problem}>
          {t("writeFailed")}
        </p>
      )}
      <ListState library={library} layout="phone" />
      {library.status !== "error" && library.foods.length > 0 && (
        <ul className={styles.list}>
          {library.foods.map((food) => (
            <li key={food.id} data-testid="food-row">
              <ListRow
                variant="food"
                title={text.title(food)}
                verified={food.verified || food.origin === "ai"}
                href={localeHref(locale, `/library/${encodeURIComponent(food.id)}`)}
                photo={<FoodPhoto src={food.photo?.thumbUrl} size={44} />}
                secondary={
                  <span className={styles.estimateLine}>
                    <span>{text.line(food)}</span>
                    {food.origin === "ai" && !food.verified && <EstimateBadge />}
                    {text.simpleOnly(food) && <SimpleBadge />}
                  </span>
                }
                trailing={
                  <VerifyCircle
                    name={food.name}
                    verified={food.verified}
                    busy={verifying.has(food.id)}
                    onVerify={() => {
                      onVerify(food.id);
                    }}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TYPING = new Set(["TEXTAREA", "SELECT"]);
const TEXT_INPUTS = new Set(["text", "search", "number", "email", "tel", "url", "password"]);
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || TYPING.has(target.tagName)) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

type Editing = { kind: "new" } | { kind: "edit"; id: string } | null;

function DesktopLibrary({
  library,
  spaceId,
  verify,
  busy,
  writeFailed,
  setWriteFailed,
}: {
  library: LibraryState;
  spaceId: string;
  verify: (ids: string[]) => Promise<boolean>;
  busy: boolean;
  writeFailed: boolean;
  setWriteFailed: (failed: boolean) => void;
}) {
  const t = useTranslations("library");
  const text = useFoodText();
  const searchId = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState(false);
  const foods = library.foods;
  const visibleSelection = selected.filter((id) => foods.some((food) => food.id === id));
  const editingFood =
    editing?.kind === "edit" ? foods.find((food) => food.id === editing.id) : undefined;

  /** The row whose `tr` (or a control inside it) has focus. */
  const activeRow = useCallback((): FoodView | undefined => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !tableRef.current?.contains(focused)) return undefined;
    const row = focused.closest("tbody tr");
    if (!(row instanceof HTMLTableRowElement)) return undefined;
    return foods[row.sectionRowIndex];
  }, [foods]);

  const verifySelected = useCallback(async () => {
    const ids = visibleSelection.length > 0 ? visibleSelection : [activeRow()?.id].filter(Boolean);
    if (ids.length === 0) return;
    if (await verify(ids as string[])) setSelected([]);
  }, [activeRow, verify, visibleSelection]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "/") {
        event.preventDefault();
        document.getElementById(searchId)?.focus();
      } else if (key === "v") {
        event.preventDefault();
        void verifySelected();
      } else if (key === "e") {
        const food = activeRow() ?? foods.find((row) => row.id === visibleSelection[0]);
        if (!food) return;
        event.preventDefault();
        setEditing({ kind: "edit", id: food.id });
      } else if ((key === "j" || key === "k") && !activeRow()) {
        const first = tableRef.current?.querySelector<HTMLTableRowElement>("tbody tr");
        if (!first) return;
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [activeRow, foods, searchId, verifySelected, visibleSelection]);

  async function removeSelected() {
    const ids = visibleSelection;
    setRemoving(true);
    setWriteFailed(false);
    const removed: string[] = [];
    try {
      for (const id of ids) {
        await libraryApi.remove(spaceId, id);
        removed.push(id);
      }
    } catch {
      setWriteFailed(true);
    } finally {
      setRemoving(false);
      setSelected((current) => current.filter((id) => !removed.includes(id)));
      if (editing?.kind === "edit" && removed.includes(editing.id)) setEditing(null);
      if (removed.length > 0) library.removeIds(removed);
    }
  }

  const columns: DataColumn<FoodView>[] = [
    {
      key: "food",
      header: t("columns.food"),
      render: (food) => (
        <div className={styles.cellFood}>
          {food.origin === "ai" && <FoodPhoto src={food.photo?.thumbUrl} size={44} />}
          <div>
            <button
              type="button"
              className={styles.cellName}
              aria-label={t("edit", { name: food.name })}
              tabIndex={-1}
              onClick={() => {
                setEditing({ kind: "edit", id: food.id });
              }}
            >
              {food.name}
            </button>
            {food.origin === "ai" && <div className={styles.askedMeta}>{text.asked(food)}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "per100g",
      header: t("columns.per100g"),
      render: (food) =>
        food.carbsPer100g == null
          ? "–"
          : t(food.origin === "ai" && !food.verified ? "estimate.gramsCell" : "gramsCell", {
              amount: text.number(food.carbsPer100g),
            }),
    },
    { key: "portions", header: t("columns.portions"), render: (food) => text.portions(food) },
    { key: "source", header: t("columns.source"), render: (food) => text.sourceName(food.origin) },
    {
      key: "status",
      header: t("columns.status"),
      render: (food) =>
        food.origin === "ai" && !food.verified ? (
          <EstimateBadge desktop />
        ) : (
          <Badge verified={food.verified} />
        ),
    },
  ];

  const summary = library.counts
    ? t("summary", { count: library.counts.all ?? 0, unverified: library.counts.unverified ?? 0 })
    : undefined;

  return (
    <section className={styles.desktop} data-testid="library-desktop">
      <div className={styles.desktopHead}>
        <PageHeader title={t("desktopTitle")} {...(summary ? { subtitle: summary } : {})} />
        <div className={styles.desktopTools}>
          <SearchField
            id={searchId}
            label={t("searchDesktop")}
            placeholder={t("searchDesktop")}
            shortcut="/"
            value={library.query}
            onChange={library.setQuery}
            onSubmit={library.submitQuery}
          />
          <Button
            onClick={() => {
              setEditing({ kind: "new" });
            }}
          >
            {t("newFood")}
          </Button>
        </div>
      </div>
      <LibraryFilters
        layout="desktop"
        value={library.filter}
        onChange={library.setFilter}
        origins={library.origins}
        unverified={library.counts?.unverified ?? 0}
      />
      <p className={styles.hint}>{t("keyboardHint")}</p>
      {writeFailed && (
        <p role="alert" className={styles.problem}>
          {t("writeFailed")}
        </p>
      )}
      <div className={styles.desktopBody} data-editing={editing !== null}>
        <div className={styles.tableColumn} ref={tableRef}>
          {visibleSelection.length > 0 && (
            <BatchBar
              count={visibleSelection.length}
              busy={busy || removing}
              onVerify={() => {
                void verifySelected();
              }}
              onRemove={() => {
                void removeSelected();
              }}
            />
          )}
          <ListState library={library} layout="desktop" />
          {library.status !== "error" && foods.length > 0 && (
            <DataTable
              rows={foods}
              columns={columns}
              rowLabel={(food) => food.name}
              selectedIds={visibleSelection}
              onSelectionChange={setSelected}
              onActivate={(food) => {
                setEditing({ kind: "edit", id: food.id });
              }}
            />
          )}
        </div>
        {editing && (editing.kind === "new" || editingFood) && (
          <EditPanel
            key={editing.kind === "new" ? "new" : editing.id}
            spaceId={spaceId}
            {...(editingFood ? { food: editingFood } : {})}
            onSaved={(saved, previous) => {
              library.replace(saved, previous);
              setEditing({ kind: "edit", id: saved.id });
            }}
            onClose={() => {
              setEditing(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

function EstimateBadge({ desktop = false }: { desktop?: boolean }) {
  const t = useTranslations("library.estimate");
  return <span className={styles.estimateBadge}>{t(desktop ? "status" : "badge")}</span>;
}

/** A small friendly face with the name "Vises i simpel visning": picked by portion in the simple view. */
function SimpleBadge() {
  const t = useTranslations("library");
  const label = t("simpleBadge");
  return (
    <span className={styles.simpleBadge} role="img" aria-label={label} title={label}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
        <path d="M9 9.5h.01M15 9.5h.01" />
      </svg>
    </span>
  );
}
