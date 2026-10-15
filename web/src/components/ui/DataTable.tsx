"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import styles from "./food-ui.module.css";

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
}
export interface DataTableProps<T> {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowLabel: (row: T) => string;
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  onActivate?: (row: T) => void;
  caption?: string;
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
            <th scope="col">{t("select")}</th>
            {columns.map((column) => (
              <th scope="col" key={column.key}>
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
              aria-selected={selected.includes(row.id)}
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
                if (key === "j" || key === "k") {
                  event.preventDefault();
                  const next =
                    rows[Math.max(0, Math.min(rows.length - 1, index + (key === "j" ? 1 : -1)))];
                  if (next) {
                    setActive(next.id);
                    refs.current.get(next.id)?.focus();
                  }
                } else if (key === " ") {
                  event.preventDefault();
                  toggle(row.id);
                } else if (key === "enter") {
                  event.preventDefault();
                  onActivate?.(row);
                }
              }}
            >
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
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
