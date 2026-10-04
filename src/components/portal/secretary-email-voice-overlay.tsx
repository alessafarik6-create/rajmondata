"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useCompany } from "@/firebase";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";
import { buildPortalEmailMessageUrl } from "@/lib/email-mailbox/email-attachment-job-ui-links";
import {
  SECRETARY_SHOW_EMAIL_ATTACHMENT_EVENT,
  SECRETARY_SHOW_EMAIL_EVENT,
  type SecretaryShowEmailAttachmentDetail,
  type SecretaryShowEmailDetail,
} from "@/lib/ai/secretary/email-voice-ui";
import { EmailPdfViewerDialog } from "@/components/portal/email-pdf-viewer-dialog";
import { isPreviewablePdf } from "@/lib/email-mailbox/attachment-meta";

type MsgPreview = {
  id: string;
  from: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  aiSummary?: string | null;
};

export function SecretaryEmailVoiceOverlay() {
  const pathname = usePathname();
  const { user } = useUser();
  const { companyId } = useCompany();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<MsgPreview | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState("");

  const onEmailPage = pathname === "/portal/email";

  const loadMessage = useCallback(
    async (emailId: string) => {
      if (!user || !companyId) return null;
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/company/email-mailbox/messages/${encodeURIComponent(emailId)}?companyId=${encodeURIComponent(companyId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await parseEmailApiResponse<{ message?: MsgPreview }>(res);
        if (data.ok && data.message) {
          setMessage(data.message);
          return data.message;
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user, companyId]
  );

  useEffect(() => {
    const onShow = (ev: Event) => {
      const detail = (ev as CustomEvent<SecretaryShowEmailDetail>).detail;
      if (!detail?.emailId) return;
      if (onEmailPage) return;
      setOpen(true);
      void loadMessage(detail.emailId);
    };
    window.addEventListener(SECRETARY_SHOW_EMAIL_EVENT, onShow);
    return () => window.removeEventListener(SECRETARY_SHOW_EMAIL_EVENT, onShow);
  }, [loadMessage, onEmailPage]);

  useEffect(() => {
    const onAttachment = async (ev: Event) => {
      const detail = (ev as CustomEvent<SecretaryShowEmailAttachmentDetail>).detail;
      if (!detail?.emailId || !detail.attachmentId || !user || !companyId) return;
      const token = await user.getIdToken();
      const url = `/api/company/email-mailbox/messages/${encodeURIComponent(detail.emailId)}/attachments/${encodeURIComponent(detail.attachmentId)}?companyId=${encodeURIComponent(companyId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const name = detail.filename ?? "příloha";
      if (isPreviewablePdf(blob.type, name)) {
        setPdfTitle(name);
        setPdfBlobUrl(blobUrl);
        setPdfOpen(true);
      } else {
        window.open(blobUrl, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener(SECRETARY_SHOW_EMAIL_ATTACHMENT_EVENT, onAttachment);
    return () => window.removeEventListener(SECRETARY_SHOW_EMAIL_ATTACHMENT_EVENT, onAttachment);
  }, [user, companyId]);

  const bodyText =
    message?.aiSummary?.trim() ||
    (message?.textBody ?? "").trim() ||
    String(message?.htmlBody ?? "")
      .replace(/<[^>]+>/g, " ")
      .slice(0, 8000);

  if (onEmailPage) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="z-[70] w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-left pr-8">{message?.subject ?? "E-mail"}</SheetTitle>
          </SheetHeader>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám zprávu…
            </div>
          ) : message ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">{message.from}</p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{bodyText}</div>
              <Button asChild variant="outline" className="w-full">
                <Link href={buildPortalEmailMessageUrl(message.id)}>Otevřít v modulu Pošta</Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6">Zprávu se nepodařilo načíst.</p>
          )}
        </SheetContent>
      </Sheet>
      <EmailPdfViewerDialog
        open={pdfOpen}
        onOpenChange={(v) => {
          setPdfOpen(v);
          if (!v && pdfBlobUrl) {
            URL.revokeObjectURL(pdfBlobUrl);
            setPdfBlobUrl(null);
          }
        }}
        title={pdfTitle}
        pdfBlobUrl={pdfBlobUrl}
      />
    </>
  );
}
