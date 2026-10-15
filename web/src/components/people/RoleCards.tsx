"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import styles from "./people.module.css";

/** The order drawn on Personer-Desktop: Hjælper, Ser med, Ejer. */
export const ROLE_ORDER: readonly Role[] = ["carer", "viewer", "owner"];

/**
 * The role as three radio cards, each with the design's one-line explanation (InvitePanel on
 * Personer-Desktop). Native radios inside labels: the arrow keys move between them and a screen
 * reader hears the title and the explanation together.
 */
export function RoleCards({
  legend,
  name,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  name: string;
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("people");
  const roles = useTranslations("roles");
  return (
    <fieldset className={styles.roleCards} disabled={disabled}>
      <legend className={styles.legend}>{legend}</legend>
      {ROLE_ORDER.map((role) => (
        <label key={role} className={styles.roleCard} data-selected={value === role}>
          <input
            type="radio"
            name={name}
            value={role}
            checked={value === role}
            onChange={() => {
              onChange(role);
            }}
            className={styles.roleRadio}
          />
          <span className={styles.roleTitle}>{roles(role)}</span>
          <span className={styles.roleHint}>{t(`roleCards.${role}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}
