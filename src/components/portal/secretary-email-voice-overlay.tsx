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
import { EmailMessageBody } from "@/components/portal/email-message-body";
import { isPreviewablePdf } from "@/lib/email-mailbox/attachment-meta";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  assistantTargetId,
  dispatchAssistantActivity,
} from "@/lib/ai/assistant/assistant-activity-client";

type MsgPreview = {
  id: string;
  from: string;
  subject: string;
  textBody?: string | null;
  htmlBody?: string | null;
  aiSummary?: string | null;
};

export function SecretaryEmailVoiceOverlay() {
  const isMobile = useIsMobile();
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
          const subj = String(data.message.subject ?? "").trim();
          const from = String(data.message.from ?? "").trim();
          dispatchAssistantActivity({
            state: "reading",
            label: subj
              ? `Čtu: ${subj.slice(0, 80)}`
              : from
                ? `Čtu e-mail od ${from.slice(0, 40)}`
                : "Čtu e-mail…",
            entityType: "email",
            entityId: data.message.id,
            targetElementId: assistantTargetId("email", data.message.id),
          });
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

  if (onEmailPage) return null;

  const sheetSide = isMobile ? "bottom" : "right";

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={sheetSide}
          className={
            isMobile
              ? "z-[70] flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col gap-0 overflow-hidden border-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-lg"
              : "z-[70] flex h-full w-full max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          }
        >
          <SheetHeader className="sticky top-0 z-10 shrink-0 border-b bg-background px-4 py-3 text-left">
            <SheetTitle className="text-left pr-8 text-base leading-snug">
              {message?.subject ?? "E-mail"}
            </SheetTitle>
            {message?.from ? (
              <p className="text-sm text-muted-foreground truncate">{message.from}</p>
            ) : null}
          </SheetHeader>
          <div
            id={message ? assistantTargetId("email", message.id) : undefined}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3"
          >
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám zprávu…
              </div>
            ) : message ? (
              <div className="space-y-4 w-full min-w-0 max-w-full">
                {message.aiSummary?.trim() ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">{message.aiSummary}</div>
                ) : null}
                <EmailMessageBody textBody={message.textBody} htmlBody={message.htmlBody} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6">Zprávu se nepodařilo načíst.</p>
            )}
          </div>
          {message ? (
            <div className="sticky bottom-0 shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Button asChild variant="outline" className="w-full min-h-[44px]">
                <Link href={buildPortalEmailMessageUrl(message.id)}>Otevřít v modulu Pošta</Link>
              </Button>
            </div>
          ) : null}
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
