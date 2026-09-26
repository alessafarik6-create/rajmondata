"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import {
  EMAIL_JOB_ATTACHMENT_ROLE_LABELS,
  EMAIL_JOB_ATTACHMENT_ROLES,
  type EmailJobAttachmentRole,
} from "@/lib/email-mailbox/email-attachment-classification";
import type { EmailDocumentAssignmentTarget } from "@/lib/email-mailbox/email-document-assignment";
import { attachmentKindLabel } from "@/lib/email-mailbox/attachment-meta";
import { useEmailJobSearch } from "@/hooks/use-email-job-search";
import { Loader2 } from "lucide-react";

type RowState = {
  target: EmailDocumentAssignmentTarget;
  jobId: string;
  jobRole: EmailJobAttachmentRole;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  messageId: string;
  attachments: EmailMessageAttachmentMeta[];
  getToken: () => Promise<string>;
  canWriteDocuments: boolean;
  canWriteEmail: boolean;
  onDone: () => void;
};

export function EmailBulkAssignAttachmentsDialog(props: Props) {
  const [jobQuery, setJobQuery] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      props.attachments.map((a) => [
        a.id,
        {
          target: "pending" as EmailDocumentAssignmentTarget,
          jobId: "",
          jobRole: "other" as EmailJobAttachmentRole,
        },
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  const { jobs, loading: jobsLoading } = useEmailJobSearch({
    companyId: props.companyId,
    enabled: props.open,
    query: jobQuery,
    getToken: props.getToken,
  });

  async function saveAll() {
    if (!props.canWriteEmail) return;
    setSaving(true);
    try {
      const token = await props.getToken();
      for (const att of props.attachments) {
        const row = rows[att.id];
        if (!row) continue;
        if (row.target === "job" && !row.jobId) continue;

        const needsDocs =
          row.target === "overhead" ||
          row.target === "pending" ||
          (row.target === "job" && row.jobRole === "invoice");
        if (needsDocs && !props.canWriteDocuments) continue;

        await fetch(
          `/api/company/email-mailbox/messages/${props.messageId}/attachments/create-document-from-attachment?companyId=${encodeURIComponent(props.companyId)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              companyId: props.companyId,
              attachmentId: att.id,
              assignmentTarget: row.target,
              updateExisting: true,
              jobId: row.target === "job" ? row.jobId : null,
              jobName: jobs.find((j) => j.id === row.jobId)?.label ?? null,
              jobAttachmentRole: row.target === "job" ? row.jobRole : null,
              form: {
                number: att.filename,
                entityName: att.filename,
                date: new Date().toISOString().slice(0, 10),
              },
            }),
          }
        );
      }
      props.onDone();
      props.onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Zařadit všechny přílohy</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Hledat zakázku (pro řádky typu Zakázka)</Label>
          <input
            className="flex h-9 w-full rounded-md border px-3 text-sm"
            value={jobQuery}
            onChange={(e) => setJobQuery(e.target.value)}
            placeholder="Číslo, zákazník, adresa…"
          />
        </div>
        <div className="space-y-4">
          {props.attachments.map((att) => {
            const row = rows[att.id]!;
            return (
              <div key={att.id} className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium truncate">{att.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {attachmentKindLabel(att.contentType, att.filename)}
                  {att.aiSummary ? ` · ${att.aiSummary.slice(0, 80)}` : ""}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select
                    value={row.target}
                    onValueChange={(v) =>
                      setRows((prev) => ({
                        ...prev,
                        [att.id]: { ...row, target: v as EmailDocumentAssignmentTarget },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="job">Zakázka</SelectItem>
                      <SelectItem value="overhead">Režie firmy</SelectItem>
                      <SelectItem value="company">Firemní doklady</SelectItem>
                      <SelectItem value="pending">Nezařazené</SelectItem>
                    </SelectContent>
                  </Select>
                  {row.target === "job" ? (
                    <>
                      <Select
                        value={row.jobId}
                        onValueChange={(v) =>
                          setRows((prev) => ({
                            ...prev,
                            [att.id]: { ...row, jobId: v },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={jobsLoading ? "…" : "Zakázka"} />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.jobRole}
                        onValueChange={(v) =>
                          setRows((prev) => ({
                            ...prev,
                            [att.id]: { ...row, jobRole: v as EmailJobAttachmentRole },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EMAIL_JOB_ATTACHMENT_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {EMAIL_JOB_ATTACHMENT_ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={saving || !props.canWriteEmail} onClick={() => void saveAll()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit zařazení"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
