"use client";

import type { ApiErrorCode, Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useRef, useState, type KeyboardEvent } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { peopleApi, PeopleApiError } from "./api-client";
import type { CreatedInviteView, MemberView, PendingInviteView, PeopleView } from "./contract";
import {
  calendarDaysBetween,
  capitalize,
  daysLeft,
  describeLastSeen,
  deviceSummary,
} from "./format";
import { InvitePanel } from "./InvitePanel";
import { InviteResult } from "./InviteResult";
import { MemberDetail } from "./MemberDetail";
import styles from "./people.module.css";

export interface PeopleScreenProps {
  locale: AppLocale;
  spaceId: string;
  spaceName: string;
  /** The space's IANA zone; every clock on the page is formatted in it. */
  timezone: string;
  currentUserId: string;
  /** The current user's role in the space when the page loaded; the list keeps it current. */
  role: Role;
  initial: PeopleView;
}

/** What follows a write: the list reloads, or the user has left the space and goes home. */
export type AfterAction = "reload" | "home";
export type RunAction = (action: () => Promise<void>, after?: AfterAction) => Promise<void>;

const COLUMNS = ["person", "role", "view", "devices", "lastSeen"] as const;

type Expanded = { kind: "member"; userId: string } | null;

/**
 * Personer: the members with their devices and the pending invitations, as one table that the
 * phone shows as rows (Personer-Telefon) and the desktop with the columns Person, Rolle, Visning,
 * Enheder, Sidst set (Personer-Desktop). The rows are keyboard navigable; a member opens into
 * their devices and, for an owner, the role cards and "Fjern". There is no glucose on this page
 * and no component path to one: a viewer reads it too.
 */
export function PeopleScreen({
  locale,
  spaceId,
  spaceName,
  timezone,
  currentUserId,
  role,
  initial,
}: PeopleScreenProps) {
  const t = useTranslations("people");
  const roles = useTranslations("roles");
  const errors = useTranslations("errors.api");
  const router = useRouter();

  const [view, setView] = useState<PeopleView>(initial);
  // Owner-only controls follow the list, so an owner who steps down sees them go at once.
  const currentRole = view.members.find((m) => m.userId === currentUserId)?.role ?? role;
  const canManage = currentRole === "owner";
  const [expanded, setExpanded] = useState<Expanded>(null);
  // Shown under the pending row: the old id until the list reloads, the new id after it.
  const [resent, setResent] = useState<{ ids: string[]; result: CreatedInviteView } | null>(null);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const tableRef = useRef<HTMLDivElement>(null);

  /**
   * Runs a write, then reloads the list so every row reflects the API's truth. A user who has
   * just removed themselves is no longer a member, so the reload would be 404: they go to the
   * front page instead, which lands on another space or on the no-space page.
   */
  const onAction = useCallback<RunAction>(
    async (action, after = "reload") => {
      setError(null);
      try {
        await action();
        if (after === "home") {
          router.push(localeHref(locale, "/"));
          router.refresh();
          return;
        }
        setView(await peopleApi.load(spaceId));
      } catch (failure) {
        setError(failure instanceof PeopleApiError ? failure.code : "internal");
      }
    },
    [locale, router, spaceId],
  );

  const toggle = (userId: string) => {
    setExpanded((current) => (current?.userId === userId ? null : { kind: "member", userId }));
  };

  const navRows = () =>
    Array.from(tableRef.current?.querySelectorAll<HTMLElement>("[data-nav-row]") ?? []);

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, member: MemberView | null) => {
    if (event.target !== event.currentTarget) return;
    const rows = navRows();
    const index = rows.indexOf(event.currentTarget);
    const go = (next: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (!target) return;
      event.preventDefault();
      setFocused(rows.indexOf(target));
      target.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        go(index + 1);
        return;
      case "ArrowUp":
        go(index - 1);
        return;
      case "Home":
        go(0);
        return;
      case "End":
        go(rows.length - 1);
        return;
      case "Enter":
      case " ":
        if (member) {
          event.preventDefault();
          toggle(member.userId);
        }
        return;
      default:
        return;
    }
  };

  const now = new Date();
  const deviceTotal = view.members.reduce((sum, m) => sum + m.devices.length, 0);
  const summary = [
    t("peopleCount", { count: view.members.length }),
    t("deviceCount", { count: deviceTotal }),
    ...(view.invites.length > 0 ? [t("pendingCount", { count: view.invites.length })] : []),
  ].join(" · ");

  const lastSeenLabel = (at: string | null) => {
    const seen = describeLastSeen(at ? new Date(at) : null, now, timezone, locale);
    switch (seen.kind) {
      case "never":
        return t("lastSeen.never");
      case "now":
        return t("lastSeen.now");
      case "today":
        return t("lastSeen.today", { time: seen.time });
      case "yesterday":
        return t("lastSeen.yesterday", { time: seen.time });
      default:
        return capitalize(seen.label);
    }
  };

  const roleLabel = (memberRole: Role) =>
    memberRole === "viewer" ? `${roles("viewer")} · ${t("noGlucose")}` : roles(memberRole);

  const phoneLine = (member: MemberView) =>
    [
      roleLabel(member.role),
      ...(member.simpleMode ? [t("simpleViewInline")] : []),
      t("deviceCount", { count: member.devices.length }),
    ].join(" · ");

  let rowIndex = 0;
  const rowProps = (index: number) => ({
    tabIndex: index === focused ? 0 : -1,
    onFocus: () => {
      setFocused(index);
    },
    "data-nav-row": "",
  });

  const memberRow = (member: MemberView) => {
    const index = rowIndex++;
    const open = expanded?.userId === member.userId;
    return (
      <Fragment key={member.userId}>
        <div
          role="row"
          className={styles.row}
          data-testid="member-row"
          data-user-id={member.userId}
          aria-expanded={open}
          aria-label={t("detail", { name: member.name })}
          onClick={() => {
            toggle(member.userId);
          }}
          onKeyDown={(event) => {
            onRowKeyDown(event, member);
          }}
          {...rowProps(index)}
        >
          <div role="cell" data-col="person" className={styles.personCell}>
            <Avatar
              name={member.name}
              size={44}
              tone={member.role === "owner" ? "owner" : "member"}
            />
            <span className={styles.personText}>
              <span className={styles.nameLine}>
                <span className={styles.name}>{member.name}</span>
                {member.userId === currentUserId && <span className={styles.you}>{t("you")}</span>}
              </span>
              <span className={`${styles.sub} ${styles.phoneOnly}`} data-testid="member-summary">
                {phoneLine(member)}
              </span>
            </span>
          </div>
          <div role="cell" data-col="role" className={styles.cell}>
            {roleLabel(member.role)}
          </div>
          <div role="cell" data-col="view" className={styles.cell}>
            {member.simpleMode ? t("view.simple") : t("view.normal")}
          </div>
          <div role="cell" data-col="devices" className={styles.cell}>
            {deviceSummary(member.devices) ?? t("deviceCount", { count: member.devices.length })}
          </div>
          <div role="cell" data-col="lastSeen" className={`${styles.cell} tabular`}>
            {lastSeenLabel(member.lastSeen)}
          </div>
        </div>
        {open && (
          <div role="row" className={styles.detailRow} data-testid="member-detail">
            <div role="cell" aria-colspan={COLUMNS.length}>
              <MemberDetail
                member={member}
                canManage={canManage}
                isSelf={member.userId === currentUserId}
                spaceId={spaceId}
                timezone={timezone}
                locale={locale}
                onAction={onAction}
              />
            </div>
          </div>
        )}
      </Fragment>
    );
  };

  const inviteRow = (invite: PendingInviteView) => {
    const index = rowIndex++;
    const sentDays = calendarDaysBetween(new Date(invite.createdAt), now, timezone);
    const left = daysLeft(new Date(invite.expiresAt), now);
    return (
      <Fragment key={invite.id}>
        <div
          role="row"
          className={`${styles.row} ${styles.inviteRow}`}
          data-testid="invite-row"
          aria-label={t("invite.pendingRow", { name: invite.name })}
          onKeyDown={(event) => {
            onRowKeyDown(event, null);
          }}
          {...rowProps(index)}
        >
          <div role="cell" data-col="person" className={styles.personCell}>
            <span className={styles.pendingAvatar} aria-hidden="true" data-testid="pending-avatar">
              {invite.name.trim().charAt(0).toLocaleUpperCase() || "·"}
            </span>
            <span className={styles.personText}>
              <span className={styles.name}>{invite.name}</span>
              <span className={styles.sub}>
                {t("invite.sent", { days: sentDays })} · {t("invite.expires", { days: left })}
              </span>
            </span>
          </div>
          <div role="cell" data-col="role" className={styles.cell}>
            {roles(invite.role)}
          </div>
          <div role="cell" data-col="view" className={styles.cell}>
            —
          </div>
          <div role="cell" data-col="devices" className={styles.cell}>
            —
          </div>
          <div role="cell" data-col="lastSeen" className={`${styles.cell} ${styles.actions}`}>
            {canManage && (
              <>
                <button
                  type="button"
                  className={styles.pillButton}
                  onClick={() => {
                    void onAction(async () => {
                      const result = await peopleApi.resendInvite(spaceId, invite.id);
                      setResent({ ids: [invite.id, result.id], result });
                    });
                  }}
                >
                  {t("invite.resend")}
                </button>
                <button
                  type="button"
                  className={styles.pillButton}
                  data-destructive="true"
                  onClick={() => {
                    void onAction(() => peopleApi.revokeInvite(spaceId, invite.id));
                  }}
                >
                  {t("invite.revoke")}
                </button>
              </>
            )}
          </div>
        </div>
        {resent?.ids.includes(invite.id) && (
          <div role="row" className={styles.detailRow}>
            <div role="cell" aria-colspan={COLUMNS.length}>
              <InviteResult
                result={resent.result}
                caption={t("invite.scanOrSend", { name: invite.name })}
                doneLabel={t("close")}
                onDone={() => {
                  setResent(null);
                }}
              />
            </div>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div className={styles.page} data-testid="people">
      <Link href={localeHref(locale, "/settings")} className={`${styles.back} ${styles.phoneOnly}`}>
        ‹ {t("back")}
      </Link>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("titleIn", { space: spaceName })}</h1>
          <p className={styles.summary} data-testid="people-summary">
            {summary}
          </p>
        </div>
        {canManage && (
          <div className={styles.phoneOnly}>
            <Button
              size="phone"
              onClick={() => {
                setInviteOpen(true);
              }}
            >
              {t("invite.button")}
            </Button>
          </div>
        )}
      </header>

      {error && (
        <Notice role="alert" tone="sunken">
          {errors(error)}
        </Notice>
      )}

      <div className={styles.layout}>
        <div className={styles.listColumn}>
          <Card className={styles.listCard}>
            <div role="table" aria-label={t("title")} className={styles.table} ref={tableRef}>
              <div role="rowgroup" className={styles.headGroup}>
                <div role="row" className={styles.headRow}>
                  {COLUMNS.map((column) => (
                    <div role="columnheader" key={column} data-col={column} className={styles.th}>
                      {t(`columns.${column}`)}
                    </div>
                  ))}
                </div>
              </div>
              <div role="rowgroup">
                {view.members.map(memberRow)}
                {view.invites.map(inviteRow)}
              </div>
            </div>
          </Card>
          {!canManage && <Notice>{t("ownerOnly")}</Notice>}
          <Notice tone="sunken" className={styles.phoneOnly}>
            {t("deviceNotice")}
          </Notice>
          <Notice className={styles.desktopOnly}>{t("deviceNoticeDesktop")}</Notice>
        </div>

        {canManage && (
          <InvitePanel
            spaceId={spaceId}
            open={inviteOpen}
            onClose={() => {
              setInviteOpen(false);
            }}
            onAction={onAction}
          />
        )}
      </div>
    </div>
  );
}
