"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import type { AppLocale } from "@/lib/i18n/routing";

import { peopleApi } from "./api-client";
import type { CreatedInviteView, DeviceView, MemberView } from "./contract";
import { describeLastSeen } from "./format";
import { InviteResult } from "./InviteResult";
import styles from "./people.module.css";
import type { RunAction } from "./PeopleScreen";
import { RoleCards } from "./RoleCards";

export interface MemberDetailProps {
  member: MemberView;
  /** The current user is an owner: role cards, remove and add-a-device are drawn. */
  canManage: boolean;
  /** This row is the current user: removing them means leaving the space. */
  isSelf: boolean;
  spaceId: string;
  timezone: string;
  locale: AppLocale;
  onAction: RunAction;
}

/** "Fjern" that asks once before it acts, inline, with the way back (no browser dialog). */
function ConfirmButton({
  label,
  question,
  onConfirm,
  destructive = true,
}: {
  label: string;
  question: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const t = useTranslations("people");
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className={styles.pillButton}
        data-destructive={destructive}
        onClick={() => {
          setAsking(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={styles.confirm} role="group">
      <span className={styles.confirmText}>{question}</span>
      <button
        type="button"
        className={styles.pillButton}
        data-destructive="true"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {t("confirm")}
      </button>
      <button
        type="button"
        className={styles.pillButton}
        onClick={() => {
          setAsking(false);
        }}
      >
        {t("cancel")}
      </button>
    </span>
  );
}

function DeviceItem({
  device,
  canManage,
  timezone,
  locale,
  onRemove,
}: {
  device: DeviceView;
  canManage: boolean;
  timezone: string;
  locale: AppLocale;
  onRemove: () => void;
}) {
  const t = useTranslations("people");
  const name = device.name ?? t("unnamedDevice");
  const seen = describeLastSeen(
    device.lastUsedAt ? new Date(device.lastUsedAt) : null,
    new Date(),
    timezone,
    locale,
  );
  const when =
    seen.kind === "never"
      ? t("deviceLastSeen.never")
      : seen.kind === "now"
        ? t("deviceLastSeen.now")
        : seen.kind === "today"
          ? t("deviceLastSeen.today", { time: seen.time })
          : seen.kind === "yesterday"
            ? t("deviceLastSeen.yesterday", { time: seen.time })
            : t("deviceLastSeen.other", { when: seen.label });
  return (
    <li className={styles.device} data-testid="device">
      <span className={styles.deviceText}>
        <span className={styles.deviceName}>{name}</span>
        <span className={styles.deviceSeen}>{when}</span>
      </span>
      {canManage && (
        <ConfirmButton
          label={t("remove")}
          question={t("confirmRemoveDevice", { device: name })}
          onConfirm={onRemove}
        />
      )}
    </li>
  );
}

/**
 * One member opened: the devices with "sidst set", and for an owner the role cards, "+ Tilføj en
 * enhed" (an add-a-device link with its QR code, design gap 9) and "Fjern". The phone member
 * detail is not drawn (design gap 24); this is the Personer-Telefon expanded row with the desktop
 * panel's role wording.
 */
export function MemberDetail({
  member,
  canManage,
  isSelf,
  spaceId,
  timezone,
  locale,
  onAction,
}: MemberDetailProps) {
  const t = useTranslations("people");
  const [deviceLink, setDeviceLink] = useState<CreatedInviteView | null>(null);

  return (
    <div className={styles.detail}>
      <section className={styles.detailSection}>
        <h3 className={styles.detailHeading}>{t("devices")}</h3>
        {member.devices.length === 0 ? (
          <p className={styles.muted}>{t("noDevices")}</p>
        ) : (
          <ul className={styles.deviceList}>
            {member.devices.map((device) => (
              <DeviceItem
                key={device.id}
                device={device}
                canManage={canManage}
                timezone={timezone}
                locale={locale}
                onRemove={() => {
                  void onAction(
                    async () => {
                      const { signedOut } = await peopleApi.removeDevice(spaceId, device.id);
                      return signedOut ? "signedOut" : "reload";
                    },
                    "reload",
                    { "last-owner": t("lastOwnerDevice") },
                  );
                }}
              />
            ))}
          </ul>
        )}
        {canManage &&
          (deviceLink ? (
            <InviteResult
              result={deviceLink}
              caption={t("invite.deviceScanOrSend", { name: member.name })}
              doneLabel={t("close")}
              onDone={() => {
                setDeviceLink(null);
              }}
            />
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                void onAction(async () => {
                  setDeviceLink(
                    await peopleApi.createInvite(spaceId, { forUserId: member.userId }),
                  );
                });
              }}
            >
              {t("addDevice")}
            </Button>
          ))}
      </section>

      {canManage && (
        <section className={styles.detailSection}>
          <RoleCards
            legend={t("role")}
            name={`role-${member.userId}`}
            value={member.role}
            onChange={(role) => {
              void onAction(() => peopleApi.changeRole(spaceId, member.userId, role));
            }}
          />
          <ConfirmButton
            label={t("removeMember", { name: member.name })}
            question={t("confirmRemoveMember", { name: member.name })}
            onConfirm={() => {
              void onAction(
                () => peopleApi.removeMember(spaceId, member.userId),
                isSelf ? "home" : "reload",
              );
            }}
          />
        </section>
      )}
    </div>
  );
}
