"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

import { peopleApi } from "./api-client";
import type { CreatedInviteView } from "./contract";
import { InviteResult } from "./InviteResult";
import styles from "./people.module.css";
import { RoleCards } from "./RoleCards";

export interface InvitePanelProps {
  spaceId: string;
  /** Phone: the sheet is open. Desktop: always shown, whatever this says. */
  open: boolean;
  onClose: () => void;
  /** Runs the call, reloads the list after it and shows its error; the screen owns both. */
  onAction: (action: () => Promise<void>) => Promise<void>;
}

/**
 * "Invitér en person": name, role cards, then the QR code and link (Personer-Desktop). The
 * phone has no artboard for it (design gap 24); the same fields open as a sheet from the button.
 */
export function InvitePanel({ spaceId, open, onClose, onAction }: InvitePanelProps) {
  const t = useTranslations("people");
  const headingId = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("carer");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreatedInviteView | null>(null);

  const reset = () => {
    setName("");
    setRole("carer");
    setResult(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    void onAction(async () => {
      setResult(await peopleApi.createInvite(spaceId, { name: trimmed, role }));
    }).finally(() => {
      setBusy(false);
    });
  };

  return (
    <aside
      className={styles.invitePanel}
      data-testid="invite-panel"
      data-open={open}
      aria-labelledby={headingId}
    >
      <Card className={styles.panelCard}>
        <div className={styles.panelHead}>
          <h2 id={headingId} className={styles.panelTitle}>
            {t("invite.title")}
          </h2>
          <button
            type="button"
            className={`${styles.closeButton} ${styles.phoneOnly}`}
            onClick={onClose}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>
        {result ? (
          <InviteResult
            result={result}
            caption={t("invite.scanOrSend", { name: result.name })}
            doneLabel={t("invite.new")}
            onDone={reset}
          />
        ) : (
          <form className={styles.form} data-testid="invite-form" onSubmit={submit}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("invite.name")}</span>
              <input
                className={styles.input}
                type="text"
                name="name"
                value={name}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <RoleCards legend={t("role")} name="invite-role" value={role} onChange={setRole} />
            <Button type="submit" disabled={busy}>
              {t("invite.create")}
            </Button>
          </form>
        )}
      </Card>
    </aside>
  );
}
