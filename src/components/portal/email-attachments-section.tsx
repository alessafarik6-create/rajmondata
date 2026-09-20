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
import { EmailPdfViewerDialog } from "@/components/portal/email-pdf-viewer-dialog";
import {
  EMAIL_ATTACHMENT_JOB_CATEGORIES,
  EMAIL_ATTACHMENT_JOB_CATEGORY_LABELS,
  userVisibleAttachments,
  isPreviewablePdf,
} from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { useToast } from "@/hooks/use-toast";
import { useEmailJobSearch } from "@/hooks/use-email-job-search";
import { Loader2 } from "lucide-react";

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
  const [selectedJobId, setSelectedJobId] = useState("");
  const [category, setCategory] = useState("document");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  const [viewerBlobUrl, setViewerBlobUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerIsPdf, setViewerIsPdf] = useState(false);
  const [viewerAtt, setViewerAtt] = useState<EmailMessageAttachmentMeta | null>(null);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);

  const { jobs, loading: jobsLoading, error: jobsError } = useEmailJobSearch({
    companyId: props.companyId,
    enabled: assignOpen,
    query: jobQuery,
    getToken: props.getToken,
  });

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

  const getPdfBlobUrlFor = useCallback(
    (attachmentId: string) => fetchBlobUrl(attachmentId, true),
    [fetchBlobUrl]
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
        setViewerAtt(att);
        const pdf = isPreviewablePdf(att.contentType, att.filename);
        setViewerIsPdf(pdf);
        setViewerBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        if (pdf) {
          setPdfViewerOpen(true);
        }
      } catch {
        toast({ variant: "destructive", title: "Náhled selhal" });
      }
    },
    [fetchBlobUrl, toast]
  );

  useEffect(() => {
    return () => {
      if (viewerBlobUrl) URL.revokeObjectURL(viewerBlobUrl);
    };
  }, [viewerBlobUrl]);

  function openAssignModal(all: boolean, attId: string | null) {
    setAssignAll(all);
    setSelectedAttId(attId);
    setJobQuery("");
    setSelectedJobId("");
    setAssignOpen(true);
  }

  async function submitAssign() {
    if (!selectedJobId) return;
    const ids = assignAll
      ? visible.map((a) => a.id)
      : selectedAttId
        ? [selectedAttId]
        : [];
    if (!ids.length) return;

    const selectedJob = jobs.find((j) => j.id === selectedJobId);
    setAssignSubmitting(true);
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
            jobDisplayName: selectedJob?.label ?? null,
          }),
        }
      );
      const data = await res.json();
      if (!data.ok) {
        toast({ variant: "destructive", title: "Přiřazení selhalo", description: data.error });
        return;
      }

      const label = data.jobLabel ?? selectedJob?.label ?? selectedJobId;
      const assigned = Number(data.attachmentsAssigned ?? 0);
      const dupes = Number(data.skippedDuplicates ?? 0);
      const failed = Number(data.failed ?? 0);
      const folderName = String(data.folderName ?? "").trim();
      const folderSuffix = folderName ? `, složka ${folderName}` : "";
      const singleName =
        !assignAll && selectedAttId
          ? visible.find((x) => x.id === selectedAttId)?.filename
          : null;

      if (assigned === 0 && dupes > 0 && failed === 0) {
        toast({
          title: "Tato příloha už je v zakázce uložená.",
          description: label,
        });
      } else if (failed > 0 && assigned > 0) {
        toast({
          variant: "destructive",
          title: `${assigned} z ${ids.length} souborů uloženo${folderSuffix}.`,
          description: `${failed} souborů selhalo.`,
        });
      } else if (assignAll && assigned > 0) {
        toast({
          title: `${assigned} příloh bylo uloženo do zakázky ${label}${folderSuffix}.`,
          description: dupes > 0 ? `${dupes} už bylo v zakázce.` : undefined,
        });
      } else if (assigned === 1 && singleName) {
        toast({
          title: `Soubor ${singleName} byl uložen do zakázky ${label}${folderSuffix}.`,
        });
      } else if (assigned > 0) {
        toast({ title: `${assigned} příloh uloženo do zakázky ${label}${folderSuffix}.` });
      } else {
        toast({ title: "Přiřazení dokončeno", description: label });
      }

      setAssignOpen(false);
      props.onLinked?.();
    } catch {
      toast({ variant: "destructive", title: "Přiřazení selhalo" });
    } finally {
      setAssignSubmitting(false);
    }
  }

  const assignDialogTitle = assignAll
    ? "Přiřadit všechny přílohy"
    : selectedAttId
      ? `Přiřadit přílohu k zakázce`
      : "Přiřadit k zakázce";

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
            onClick={() => openAssignModal(true, null)}
          >
            Přiřadit všechny k zakázce
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((att) => (
          <EmailAttachmentCard
            key={att.id}
            messageId={props.messageId}
            attachment={att}
            canWrite={props.canWrite}
            busy={props.busy || assignSubmitting}
            onDownload={() => void downloadAttachment(att)}
            onOpen={() => void openAttachment(att)}
            getPdfBlobUrl={
              isPreviewablePdf(att.contentType, att.filename) && att.storagePath
                ? () => getPdfBlobUrlFor(att.id)
                : undefined
            }
            onAssign={
              props.canWrite
                ? () => openAssignModal(false, att.id)
                : undefined
            }
          />
        ))}
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{assignDialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Hledat zakázku (číslo, zákazník, adresa…)"
              value={jobQuery}
              onChange={(e) => setJobQuery(e.target.value)}
            />
            {jobsError ? (
              <p className="text-sm text-destructive">{jobsError}</p>
            ) : jobsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Načítám zakázky…
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {jobQuery.trim() ? "Žádná zakázka neodpovídá hledání." : "Žádné zakázky k zobrazení."}
              </p>
            ) : null}
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Vyberte zakázku" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.label || j.id}
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
            <Button
              disabled={!selectedJobId || props.busy || assignSubmitting}
              onClick={() => void submitAssign()}
            >
              {assignSubmitting ? "Ukládám…" : "Přiřadit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmailPdfViewerDialog
        open={pdfViewerOpen}
        onOpenChange={(o) => {
          setPdfViewerOpen(o);
          if (!o) {
            setViewerBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
        }}
        title={viewerTitle}
        pdfBlobUrl={viewerBlobUrl}
        onDownload={viewerAtt ? () => void downloadAttachment(viewerAtt) : undefined}
      />

      <Dialog
        open={Boolean(viewerBlobUrl) && !viewerIsPdf}
        onOpenChange={(o) => {
          if (!o) {
            setViewerBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="truncate">{viewerTitle}</DialogTitle>
          </DialogHeader>
          {viewerBlobUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewerBlobUrl} alt="" className="max-h-[70vh] w-full object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
