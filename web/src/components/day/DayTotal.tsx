import styles from "./day.module.css";

/** "102 · g kulhydrat indtil nu": the day's carbs at 72 px with its words beside it. */
export function DayTotal({ carbs, suffix }: { carbs: number; suffix: string }) {
  return (
    <p className={styles.total} data-testid="day-total">
      <span className={styles.totalNumber}>{carbs}</span>
      <span className={styles.totalSuffix}>{suffix}</span>
    </p>
  );
}
