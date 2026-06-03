"use client";

import React, { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatNotificationRecipientsSummary,
  recipientRowKey,
  type JobNotificationRecipient,
} from "@/lib/job-notification-recipients";
import { createCustomEmailRecipient } from "@/lib/job-notification-recipient-presets";
import { X } from "lucide-react";

type Props = {
  enabled: boolean;
  recipients: JobNotificationRecipient[];
  onEnabledChange: (enabled: boolean) => void;
  onRecipientsChange: (recipients: JobNotificationRecipient[]) => void;
  disabled?: boolean;
  allowCustomEmail?: boolean;
  className?: string;
};

function roleLabel(type: JobNotificationRecipient["type"]): string {
  switch (type) {
    case "employee":
      return "Zaměstnanec";
    case "customer":
      return "Zákazník";
    case "admin":
      return "Admin";
    case "custom_email":
      return "Vlastní e-mail";
  }
}

export function JobEmailNotificationRecipientsPanel({
  enabled,
  recipients,
  onEnabledChange,
  onRecipientsChange,
  disabled = false,
  allowCustomEmail = true,
  className,
}: Props) {
  const [customEmail, setCustomEmail] = useState("");
  const summary = useMemo(
    () => formatNotificationRecipientsSummary(recipients, enabled),
    [recipients, enabled]
  );

  const setRecipientEnabled = (key: string, next: boolean) => {
    onRecipientsChange(
      recipients.map((r) =>
        recipientRowKey(r) === key ? { ...r, enabled: next } : r
      )
    );
  };

  const removeRecipient = (key: string) => {
    onRecipientsChange(recipients.filter((r) => recipientRowKey(r) !== key));
  };

  const addCustomEmail = () => {
    const row = createCustomEmailRecipient(customEmail);
    if (!row) return;
    const exists = recipients.some((r) => recipientRowKey(r) === recipientRowKey(row));
    if (exists) {
      onRecipientsChange(
        recipients.map((r) =>
          recipientRowKey(r) === recipientRowKey(row) ? { ...r, enabled: true } : r
        )
      );
    } else {
      onRecipientsChange([...recipients, row]);
    }
    setCustomEmail("");
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border border-border/60 bg-muted/15 p-3",
        className
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        E-mailové notifikace
      </p>
      <div className="flex items-center gap-2">
        <Switch
          id="email-notify-enabled"
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
        <Label htmlFor="email-notify-enabled" className="cursor-pointer text-sm font-normal">
          Posílat notifikace
        </Label>
      </div>
      <p className="text-xs leading-snug text-muted-foreground">{summary}</p>

      {enabled ? (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Příjemci notifikací</p>
            {!recipients.length ? (
              <p className="text-xs text-muted-foreground">
                Zatím žádní příjemci. Zapněte viditelnost složky nebo přidejte e-mail.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {recipients.map((r) => {
                  const key = recipientRowKey(r);
                  const canRemove = r.type === "custom_email";
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center gap-2 rounded border border-border/50 bg-background px-2 py-1.5"
                    >
                      <Switch
                        checked={r.enabled}
                        disabled={disabled}
                        onCheckedChange={(v) => setRecipientEnabled(key, v)}
                        aria-label={`Příjemce ${r.email}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {r.name?.trim() || r.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {roleLabel(r.type)}
                      </Badge>
                      {canRemove ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={disabled}
                          onClick={() => removeRecipient(key)}
                          aria-label="Odebrat příjemce"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {allowCustomEmail ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="custom-notify-email" className="text-xs">
                  Přidat vlastní e-mail
                </Label>
                <Input
                  id="custom-notify-email"
                  type="email"
                  value={customEmail}
                  disabled={disabled}
                  placeholder="info@firma.cz"
                  onChange={(e) => setCustomEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomEmail();
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={disabled || !customEmail.trim()}
                onClick={addCustomEmail}
              >
                Přidat
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
