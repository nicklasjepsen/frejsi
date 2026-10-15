import styles from "./ui.module.css";

export type AvatarTone = "subject" | "member" | "owner";

/** The initial on a tinted circle; decorative, the name is always written next to it. */
export function Avatar({
  name,
  size,
  tone = "subject",
}: {
  name: string;
  size: number;
  tone?: AvatarTone;
}) {
  const initial = name.trim().charAt(0).toLocaleUpperCase() || "·";
  return (
    <span
      className={styles.avatar}
      data-tone={tone}
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initial}
    </span>
  );
}
