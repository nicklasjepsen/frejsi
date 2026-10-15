"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import styles from "./food-ui.module.css";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** `end` right-aligns a numeric column (Maaltid-Desktop). */
  align?: "start" | "end";
}
export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowLabel: (row: T) => string;
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  onActivate?: (row: T) => void;
  caption?: string;
  /**
   * `false` drops the checkbox column; the focused row is then the selection, moved with J/K
   * and the arrow keys (MealStatsTable). Default `true`.
   */
  selectable?: boolean;
  /** The row drawn at 700, e.g. the meal on screen. */
  currentId?: string;
}

/** Roving row focus; native controls inside cells keep their own keyboard behaviour. */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  rowLabel,
  selectedIds,
  onSelectionChange,
  onActivate,
  caption,
  selectable = true,
  currentId,
}: DataTableProps<T>) {
  const t = useTranslations("foodKit");
  const [active, setActive] = useState<string | null>(null);
  const [localSelection, setLocalSelection] = useState<string[]>([]);
  const selected = selectedIds ?? localSelection;
  const refs = useRef(new Map<string, HTMLTableRowElement>());
  const activeId = rows.some((row) => row.id === active) ? active : rows[0]?.id;
  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id];
    setLocalSelection(next);
    onSelectionChange?.(next);
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {selectable && <th scope="col">{t("select")}</th>}
            {columns.map((column) => (
              <th scope="col" key={column.key} data-align={column.align}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              ref={(el) => {
                if (el) refs.current.set(row.id, el);
                else refs.current.delete(row.id);
              }}
              tabIndex={row.id === activeId ? 0 : -1}
              aria-selected={selectable ? selected.includes(row.id) : row.id === activeId}
              data-current={row.id === currentId ? "true" : undefined}
              onFocus={() => {
                setActive(row.id);
              }}
              onClick={() => {
                setActive(row.id);
              }}
              onKeyDown={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey
                )
                  return;
                const key = event.key.toLowerCase();
                const step =
                  key === "j" || key === "arrowdown"
                    ? 1
                    : key === "k" || key === "arrowup"
                      ? -1
                      : 0;
                if (step !== 0) {
                  event.preventDefault();
                  const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
                  if (next) {
                    setActive(next.id);
                    refs.current.get(next.id)?.focus();
                  }
                } else if (key === " " && selectable) {
                  event.preventDefault();
                  toggle(row.id);
                } else if (key === "enter") {
                  event.preventDefault();
                  onActivate?.(row);
                }
              }}
            >
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    aria-label={t("selectRow", { name: rowLabel(row) })}
                    checked={selected.includes(row.id)}
                    onChange={() => {
                      toggle(row.id);
                    }}
                  />
                </td>
              )}
              {columns.map((column) => (
                <td key={column.key} data-align={column.align}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
