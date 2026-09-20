"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmailAttachmentCard } from "@/components/portal/email-attachment-card";
import {
  EMAIL_ATTACHMENT_JOB_CATEGORIES,
  EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS,
  userVisibleAttachments,
} from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { useToast } from "@/hooks/use-toast";

type JobRow = {
  id: string;
  orderNumber: string;
  title: string;
  customerName: string;
};

type Props = {
  companyId: string;
  messageId: string;
  attachments: EmailMessageAttachmentMeta[] | null | undefined;
  canWrite: boolean;
  busy?: boolean;
  getToken: () => Promise<string>;
  onLinked?: () => void;
};

export function EmailAttachmentsSection(props: Props) {
  const { toast } = useToast();
  const visible = useMemo(
    () => userVisibleAttachments(props.attachments),
    [props.attachments]
  );
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignAll, setAssignAll] = useState(false);
  const [selectedAttId, setSelectedAttId] = useState<string | null>(null);
  const [jobQuery, setJobQuery] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [category, setCategory] = useState("document");
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");

  const apiBase = useCallback(
    (attachmentId: string, inline?: boolean) =>
      `/api/company/email-mailbox/messages/${props.messageId}/attachments/${attachmentId}?companyId=${encodeURIComponent(props.companyId)}${inline ? "&disposition=inline" : ""}`,
    [props.companyId, props.messageId]
  );

  const fetchBlobUrl = useCallback(
    async (attachmentId: string, inline?: boolean) => {
      const token = await props.getToken();
      const res = await fetch(apiBase(attachmentId, inline), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Přílohu nelze načíst.");
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    [apiBase, props]
  );

  const downloadAttachment = useCallback(
    async (att: EmailMessageAttachmentMeta) => {
      try {
        const url = await fetchBlobUrl(att.id, false);
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch {
        toast({ variant: "destructive", title: "Stažení selhalo" });
      }
    },
    [fetchBlobUrl, toast]
  );

  const openAttachment = useCallback(
    async (att: EmailMessageAttachmentMeta) => {
      try {
        const url = await fetchBlobUrl(att.id, true);
        setViewerTitle(att.filename);
        setViewerUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        toast({ variant: "destructive", title: "Náhled selhal" });
      }
    },
    [fetchBlobUrl, toast]
  );

  useEffect(() => {
    return () => {
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    };
  }, [viewerUrl]);

  useEffect(() => {
    if (!assignOpen || jobQuery.trim().length < 2) {
      setJobs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const token = await props.getToken();
      const res = await fetch(
        `/api/company/email-mailbox/jobs-search?companyId=${encodeURIComponent(props.companyId)}&q=${encodeURIComponent(jobQuery)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (!cancelled && data.ok) setJobs(data.jobs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [assignOpen, jobQuery, props]);

  async function submitAssign() {
    if (!selectedJobId) return;
    const ids = assignAll
      ? visible.map((a) => a.id)
      : selectedAttId
        ? [selectedAttId]
        : [];
    if (!ids.length) return;
    try {
      const token = await props.getToken();
      const res = await fetch(
        `/api/company/email-mailbox/messages/${props.messageId}/attachments/assign-job?companyId=${encodeURIComponent(props.companyId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            companyId: props.companyId,
            jobId: selectedJobId,
            attachmentIds: ids,
            category,
          }),
        }
      );
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Přiřazení selhalo", description: data.error });
        return;
      }
      toast({ title: assignAll ? "Všechny přílohy přiřazeny" : "Příloha přiřazena k zakázce" });
      setAssignOpen(false);
      props.onLinked?.();
    } catch {
      toast({ variant: "destructive", title: "Přiřazení selhalo" });
    }
  }

  if (!visible.length) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Přílohy ({visible.length})
        </h3>
        {props.canWrite ? (
          <Button
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={() => {
              setAssignAll(true);
              setSelectedAttId(null);
              setAssignOpen(true);
            }}
          >
            Přiřadit všechny k zakázce
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((att) => (
          <EmailAttachmentCard
            key={att.id}
            attachment={att}
            canWrite={props.canWrite}
            busy={props.busy}
            onDownload={() => void downloadAttachment(att)}
            onOpen={() => void openAttachment(att)}
            onAssign={
              props.canWrite
                ? () => {
                    setAssignAll(false);
                    setSelectedAttId(att.id);
                    setAssignOpen(true);
                  }
                : undefined
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((att) => (
          <Button key={`dl-${att.id}`} size="sm" variant="ghost" onClick={() => void downloadAttachment(att)}>
            Stáhnout {att.filename}
          </Button>
        ))}
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{assignAll ? "Přiřadit všechny přílohy" : "Přiřadit k zakázce"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Hledat zakázku (číslo, zákazník, adresa…)"
              value={jobQuery}
              onChange={(e) => setJobQuery(e.target.value)}
            />
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Vyberte zakázku" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {[j.orderNumber, j.title, j.customerName].filter(Boolean).join(" · ") || j.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Kategorie dokumentu" />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_ATTACHMENT_JOB_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Zrušit
            </Button>
            <Button disabled={!selectedJobId || props.busy} onClick={() => void submitAssign()}>
              Přiřadit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewerUrl)} onOpenChange={(o) => !o && setViewerUrl(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="truncate">{viewerTitle}</DialogTitle>
          </DialogHeader>
          {viewerUrl ? (
            viewerTitle.toLowerCase().endsWith(".pdf") ? (
              <iframe title={viewerTitle} src={viewerUrl} className="w-full h-[70vh] rounded border" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewerUrl} alt="" className="max-h-[70vh] w-full object-contain" />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
