"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailAttachmentCard } from "@/components/portal/email-attachment-card";
import { EmailPdfViewerDialog } from "@/components/portal/email-pdf-viewer-dialog";
import { EmailDocumentFromAttachmentDialog } from "@/components/portal/email-document-from-attachment-dialog";
import {
  userVisibleAttachments,
  isPreviewablePdf,
} from "@/lib/email-mailbox/attachment-meta";
import type { EmailMessageAttachmentMeta } from "@/lib/email-mailbox/types";
import { useToast } from "@/hooks/use-toast";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import {
  buildEmailDocumentOpenHref,
  resolveEmailDocumentIdFromAttachment,
} from "@/lib/email-mailbox/email-document-link";

type Props = {
  companyId: string;
  messageId: string;
  attachments: EmailMessageAttachmentMeta[] | null | undefined;
  canWrite: boolean;
  busy?: boolean;
  getToken: () => Promise<string>;
  onLinked?: () => void;
  /** Návrh zakázky z AI e-mailu — výchozí volba v dialogu dokladu, ne automatická vazba. */
  suggestedJobIdFromEmail?: string | null;
};

export function EmailAttachmentsSection(props: Props) {
  const { toast } = useToast();
  const docsAccess = usePortalModuleAccess("documents");
  const visible = useMemo(
    () => userVisibleAttachments(props.attachments),
    [props.attachments]
  );

  const [classifyAttId, setClassifyAttId] = useState<string | null>(null);
  const [resolvedDocs, setResolvedDocs] = useState<Record<string, string>>({});

  const [viewerBlobUrl, setViewerBlobUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState("");
  const [viewerIsPdf, setViewerIsPdf] = useState(false);
  const [viewerAtt, setViewerAtt] = useState<EmailMessageAttachmentMeta | null>(null);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);

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

  useEffect(() => {
    if (!docsAccess.canRead || !visible.length) return;
    let cancelled = false;
    (async () => {
      const token = await props.getToken();
      const next: Record<string, string> = {};
      for (const att of visible) {
        const local = resolveEmailDocumentIdFromAttachment(props.messageId, att);
        if (att.linkedDocumentId || att.createdDocumentId) {
          next[att.id] = local ?? att.linkedDocumentId ?? att.createdDocumentId ?? "";
          continue;
        }
        try {
          const q = new URLSearchParams({
            companyId: props.companyId,
            attachmentId: att.id,
          });
          const res = await fetch(
            `/api/company/email-mailbox/messages/${props.messageId}/attachments/document-for-attachment?${q}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const data = (await res.json()) as { documentId?: string | null };
          if (data.documentId) next[att.id] = data.documentId;
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setResolvedDocs((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, props.companyId, props.messageId, props.getToken, docsAccess.canRead]);

  function documentIdFor(att: EmailMessageAttachmentMeta): string | null {
    return (
      resolvedDocs[att.id]?.trim() ||
      resolveEmailDocumentIdFromAttachment(props.messageId, att) ||
      null
    );
  }

  const classifyAttachment = visible.find((a) => a.id === classifyAttId) ?? null;

  if (!visible.length) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Přílohy ({visible.length})
        </h3>
        {props.canWrite && visible.length > 1 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={props.busy}
            onClick={() =>
              toast({
                title: "Zařazení po jednotlivých přílohách",
                description:
                  "U každé přílohy zvolte „Zařadit doklad“ — faktura může jít do režie, jiná příloha k zakázce.",
              })
            }
          >
            Zařadit všechny přílohy
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((att) => {
          const docId = documentIdFor(att);
          const docHref =
            docId && docsAccess.canRead
              ? buildEmailDocumentOpenHref({ documentId: docId, messageId: props.messageId })
              : null;
          return (
            <EmailAttachmentCard
              key={att.id}
              messageId={props.messageId}
              attachment={att}
              canWrite={props.canWrite}
              busy={props.busy}
              documentId={docId}
              documentOpenHref={docHref}
              onDownload={() => void downloadAttachment(att)}
              onOpen={() => void openAttachment(att)}
              getPdfBlobUrl={
                isPreviewablePdf(att.contentType, att.filename) && att.storagePath
                  ? () => getPdfBlobUrlFor(att.id)
                  : undefined
              }
              onClassifyDocument={
                props.canWrite && docsAccess.canWrite
                  ? () => setClassifyAttId(att.id)
                  : undefined
              }
            />
          );
        })}
      </div>

      {classifyAttachment ? (
        <EmailDocumentFromAttachmentDialog
          open={Boolean(classifyAttId)}
          onOpenChange={(o) => {
            if (!o) setClassifyAttId(null);
          }}
          companyId={props.companyId}
          messageId={props.messageId}
          attachment={classifyAttachment}
          getToken={props.getToken}
          canWriteDocuments={docsAccess.canWrite}
          suggestedJobIdFromEmail={props.suggestedJobIdFromEmail}
          onSaved={(documentId, label) => {
            setResolvedDocs((prev) => ({ ...prev, [classifyAttachment.id]: documentId }));
            setClassifyAttId(null);
            props.onLinked?.();
            void label;
          }}
        />
      ) : null}

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
