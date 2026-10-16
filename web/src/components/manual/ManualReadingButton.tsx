"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "../ui/Button";
import { ManualReadingSheet } from "./ManualReadingSheet";

/** The sheet's state for the Now screen: both layouts' buttons open the one sheet. */
export function useManualReading() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: () => {
      setOpen(true);
    },
    hide: () => {
      setOpen(false);
    },
  };
}

/** "Indtast måling": the secondary button on Now for a space whose source is Manuelt. */
export function ManualReadingButton({
  size,
  onClick,
}: {
  size: "phone" | "desktop";
  onClick: () => void;
}) {
  const t = useTranslations("manual");
  return (
    <Button variant="secondary" size={size} onClick={onClick}>
      {t("button")}
    </Button>
  );
}

export { ManualReadingSheet };
