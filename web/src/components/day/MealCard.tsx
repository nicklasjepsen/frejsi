"use client";

import type { Role } from "@frejsi/shared/schemas/index";
import type { DayMealView } from "@frejsi/shared/schemas/meal";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import styles from "./day.module.css";

export type MealCardVariant = "card" | "row" | "simple";

const PHOTO_SIZE: Record<MealCardVariant, number> = { card: 64, row: 48, simple: 96 };

/** The roles that may change a meal; the route refuses the others whatever the card shows. */
const EDITING_ROLES: readonly Role[] = ["owner", "carer"];

/**
 * One meal (design README `MealCard`): `card` is the phone card on Nu ("12:10 · 50 g kulhydrat ·
 * Jonas"), `row` the timeline row of the day with its 48 px time column, `simple` the simpleMode
 * card ("Du spiste kl. 12:10" above the title). The photo is the thumbnail, or the placeholder.
 * The optional row detail is supplied by history; the default remains the meal-only metadata.
 *
 * With a `locale` the whole card is a link to the meal's detail, and with an owner's or carer's
 * `role` the card and the row trail a 44 px "Ret" that opens the detail with its edit sheet
 * (`?edit=1`). The simple card never carries an edit affordance (v0.6.0 task 8).
 */
export function MealCard({
  meal,
  timeZone,
  variant,
  detail,
  locale,
  role,
}: {
  meal: DayMealView;
  timeZone: string;
  variant: MealCardVariant;
  /** Timeline metadata, including a timestamped peak when the caller has permission. */
  detail?: ReactNode;
  /** Links the card to `/meal/<id>`; without it the card is plain. */
  locale?: AppLocale;
  /** The member's role, from the call site; only an owner or carer gets "Ret". */
  role?: Role;
}) {
  const t = useTranslations("today");
  const time = formatClock(new Date(meal.ts), timeZone);
  const size = PHOTO_SIZE[variant];
  const href = locale ? localeHref(locale, `/meal/${encodeURIComponent(meal.id)}`) : undefined;
  const editHref =
    href !== undefined && variant !== "simple" && role !== undefined && EDITING_ROLES.includes(role)
      ? `${href}?edit=1`
      : undefined;
  const photo = (
    <span className={styles.photo} style={{ width: size, height: size }}>
      <FoodPhoto src={meal.photo?.thumbUrl} alt={meal.title} size={size} />
    </span>
  );
  const title = <span className={styles.title}>{meal.title}</span>;
  const facts = { time, carbs: meal.totalCarbs, name: meal.byUser.name };
  const edit = editHref !== undefined && (
    <Link
      href={editHref}
      className={styles.edit}
      aria-label={t("editMeal", { time })}
      data-testid="meal-edit"
    >
      {t("edit")}
    </Link>
  );

  if (variant === "simple") {
    return (
      <article className={styles.simple} data-testid="meal-card" data-variant={variant}>
        <Target href={href}>
          {photo}
          <div className={styles.text}>
            <span className={styles.meta}>{t("youAte", { time })}</span>
            {title}
          </div>
        </Target>
      </article>
    );
  }

  if (variant === "card") {
    return (
      <article className={styles.card} data-testid="meal-card" data-variant={variant}>
        <Target href={href}>
          {photo}
          <div className={styles.text}>
            {title}
            <span className={styles.meta}>{t("mealMeta", facts)}</span>
          </div>
        </Target>
        {edit}
      </article>
    );
  }

  return (
    <article className={styles.row} data-testid="meal-card" data-variant={variant}>
      <Target href={href}>
        <time className={styles.time} dateTime={meal.ts}>
          {time}
        </time>
        {photo}
        <div className={styles.text}>
          {title}
          <span className={styles.meta}>{detail ?? t("mealCarbs", facts)}</span>
        </div>
      </Target>
      {edit}
    </article>
  );
}

/** The card's body: the link that fills it, or a plain box when the card links nowhere. */
function Target({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (href === undefined) return <div className={styles.body}>{children}</div>;
  return (
    <Link href={href} className={styles.body}>
      {children}
    </Link>
  );
}
