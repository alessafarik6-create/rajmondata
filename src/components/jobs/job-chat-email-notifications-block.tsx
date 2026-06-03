"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { updateDoc, serverTimestamp } from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { JobEmailNotificationRecipientsPanel } from "@/components/jobs/job-email-notification-recipients-panel";
import { Button } from "@/components/ui/button";
import {
  parseJobCustomerChatNotificationSettings,
  parseJobInternalChatNotificationSettings,
  type JobNotificationRecipient,
} from "@/lib/job-notification-recipients";
import {
  buildDefaultCustomerChatRecipients,
  buildDefaultInternalChatRecipients,
} from "@/lib/job-notification-recipient-presets";

type Presets = {
  employeeCandidates: JobNotificationRecipient[];
  customerCandidates: JobNotificationRecipient[];
  adminCandidates: JobNotificationRecipient[];
};

type Props = {
  kind: "internal" | "customer";
  job: Record<string, unknown> | null | undefined;
  jobRef: DocumentReference | null;
  presets: Presets;
  disabled?: boolean;
  className?: string;
};

export function JobChatEmailNotificationsBlock({
  kind,
  job,
  jobRef,
  presets,
  disabled = false,
  className,
}: Props) {
  const parsed = useMemo(
    () =>
      kind === "internal"
        ? parseJobInternalChatNotificationSettings(job)
        : parseJobCustomerChatNotificationSettings(job),
    [kind, job]
  );

  const [enabled, setEnabled] = useState(parsed.enabled);
  const [recipients, setRecipients] = useState(parsed.recipients);
  const [saving, setSaving] = useState(false);

  const recipientsKey = useMemo(
    () => JSON.stringify(parsed.recipients),
    [parsed.recipients]
  );

  useEffect(() => {
    setEnabled(parsed.enabled);
    setRecipients(parsed.recipients);
  }, [parsed.enabled, recipientsKey, parsed.recipients]);

  const persist = useCallback(
    async (nextEnabled: boolean, nextRecipients: JobNotificationRecipient[]) => {
      if (!jobRef) return;
      setSaving(true);
      try {
        const patch =
          kind === "internal"
            ? {
                internalChatEmailNotificationsEnabled: nextEnabled,
                internalChatNotificationRecipients: nextRecipients,
                internalChatEmailNotifications: nextEnabled,
                updatedAt: serverTimestamp(),
              }
            : {
                customerChatEmailNotificationsEnabled: nextEnabled,
                customerChatNotificationRecipients: nextRecipients,
                customerChatEmailNotifications: nextEnabled,
                updatedAt: serverTimestamp(),
              };
        await updateDoc(jobRef, patch);
      } finally {
        setSaving(false);
      }
    },
    [jobRef, kind]
  );

  const loadDefaults = () => {
    const next =
      kind === "internal"
        ? buildDefaultInternalChatRecipients(
            presets.employeeCandidates,
            presets.adminCandidates
          )
        : buildDefaultCustomerChatRecipients(
            presets.customerCandidates,
            presets.adminCandidates
          );
    setRecipients(next);
    void persist(enabled, next);
  };

  return (
    <div className={className}>
      <JobEmailNotificationRecipientsPanel
        enabled={enabled}
        recipients={recipients}
        disabled={disabled || saving}
        onEnabledChange={(v) => {
          setEnabled(v);
          void persist(v, recipients);
        }}
        onRecipientsChange={(rows) => {
          setRecipients(rows);
          void persist(enabled, rows);
        }}
      />
      {!recipients.length && enabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={disabled || saving}
          onClick={loadDefaults}
        >
          Načíst výchozí příjemce
        </Button>
      ) : null}
    </div>
  );
}
