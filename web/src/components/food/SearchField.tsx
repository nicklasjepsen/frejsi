"use client";
import { useId } from "react";
import { Kbd } from "../ui/Kbd";
import styles from "./food.module.css";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  icon?: "search" | "barcode";
  shortcut?: string;
  hint?: string;
  placeholder?: string;
  id?: string;
}
export function SearchField({
  label,
  value,
  onChange,
  onSubmit,
  icon = "search",
  shortcut,
  hint,
  placeholder,
  id,
}: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.search}>
      <svg
        data-testid="search-icon"
        data-icon={icon}
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        {icon === "search" ? (
          <>
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 5 5" />
          </>
        ) : (
          <path d="M3 5v14M6 5v14M10 5v14M12 5v14M16 5v14M18 5v14M21 5v14" />
        )}
      </svg>
      <input
        id={inputId}
        aria-label={label}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit(event.currentTarget.value);
          }
        }}
      />
      {shortcut && <Kbd>{shortcut}</Kbd>}
      {hint && (
        <span id={`${inputId}-hint`} className={styles.searchHint}>
          {hint}
        </span>
      )}
    </div>
  );
}
