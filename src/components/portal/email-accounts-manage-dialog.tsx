"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailMyMailboxSettingsCard } from "@/components/settings/email-my-mailbox-settings-card";

export function EmailAccountsManageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string | null;
}) {
  const { open, onOpenChange, companyId } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Správa e-mailových účtů</DialogTitle>
          <DialogDescription>
            Připojte další schránku, změňte heslo nebo odpojte účet. Firemní sdílené schránky spravuje
            administrátor v nastavení organizace.
          </DialogDescription>
        </DialogHeader>
        <EmailMyMailboxSettingsCard companyId={companyId} embedded />
      </DialogContent>
    </Dialog>
  );
}
