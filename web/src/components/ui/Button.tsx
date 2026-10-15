import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./ui.module.css";

type Variant = "primary" | "secondary";
type Size = "desktop" | "phone" | "simple";

type Props = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  href?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

/** The accent button (primary) or the outlined one (secondary); a link when given an href. */
export function Button({ children, variant = "primary", size = "desktop", href, ...rest }: Props) {
  if (href !== undefined) {
    return (
      <Link href={href} className={styles.button} data-variant={variant} data-size={size}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...rest}
      className={styles.button}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  );
}
