"use client";
import { useId, type InputHTMLAttributes } from "react";
import styles from "./food-ui.module.css";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & { label: string };
export function TextInput({ label, id, type = "text", className = "", ...props }: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label className={styles.inputLabel} htmlFor={inputId}>
      {label}
      <input {...props} id={inputId} type={type} className={`${styles.input} ${className}`} />
    </label>
  );
}
