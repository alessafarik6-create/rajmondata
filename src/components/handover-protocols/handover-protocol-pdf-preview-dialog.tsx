"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { PortalInvoicePreviewDialog } from "@/components/invoices/portal-invoice-preview-dialog";
import {
  handoverProtocolFormFromDoc,
  type HandoverProtocolDoc,
  type HandoverProtocolForm,
} from "@/lib/handover-protocol-types";
import { buildHandoverProtocolHtmlForPreview } from "@/lib/handover-protocol-pdf-build";
import type { HandoverProtocolPdfSnapshot } from "@/lib/handover-protocol-pdf-build";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export type HandoverProtocolDraftPreview = {
  form: HandoverProtocolForm;
  snapshot: HandoverProtocolPdfSnapshot;
  protocolNumber?: string;
};

export function HandoverProtocolPdfPreviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protocol?: HandoverProtocolDoc | null;
  draft?: HandoverProtocolDraftPreview | null;
  companyDoc: Record<string, unknown> | null;
  user?: User | null;
  onSendEmail?: () => void;
  showSendEmail?: boolean;
}) {
  const { open, onOpenChange, protocol, draft, companyDoc, user, onSendEmail, showSendEmail } =
    props;
  const { toast } = useToast();
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => {
    if (draft?.form.documentTitle?.trim()) return draft.form.documentTitle.trim();
    if (protocol) {
      const form = handoverProtocolFormFromDoc(protocol as unknown as Record<string, unknown>);
      return form.documentTitle || "Předávací protokol";
    }
    return "Předávací protokol";
  }, [protocol, draft]);

  useEffect(() => {
    if (!open) {
      setHtml("");
      return;
    }
    setLoading(true);
    try {
      if (draft) {
        const built = buildHandoverProtocolHtmlForPreview({
          companyDoc,
          snapshot: draft.snapshot,
          form: draft.form,
          protocolNumber: draft.protocolNumber,
        });
        setHtml(built);
        return;
      }
      if (!protocol) {
        setHtml("");
        return;
      }
      const form = handoverProtocolFormFromDoc(protocol as unknown as Record<string, unknown>);
      const built = buildHandoverProtocolHtmlForPreview({
        companyDoc,
        snapshot: {
          jobNumber: String(protocol.jobNumber ?? ""),
          jobName: String(protocol.jobName ?? ""),
          workContractNumber: String(protocol.workContractNumber ?? ""),
          customerName: String(protocol.customerName ?? ""),
          customerPhone: String(protocol.customerPhone ?? ""),
          customerEmail: String(protocol.customerEmail ?? ""),
          realizationAddress: String(protocol.realizationAddress ?? ""),
          createdAtLabel: String(protocol.createdAtLabel ?? ""),
          contractorCompanyName: String(protocol.contractorCompanyName ?? ""),
        },
        form,
        protocolNumber: String(protocol.protocolNumber ?? protocol.id),
        contractorSignature: protocol.contractorSignature,
        customerSignature: protocol.customerSignature,
        attachments: protocol.attachments,
      });
      setHtml(built);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Náhled",
        description: e instanceof Error ? e.message : "Nelze sestavit náhled.",
      });
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, [open, protocol, draft, companyDoc, toast]);

  if (!open) return null;

  if (loading || !html) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <PortalInvoicePreviewDialog
      open={open}
      onOpenChange={onOpenChange}
      html={html}
      title={title}
      user={user}
      onSendEmail={onSendEmail}
      showSendEmail={showSendEmail}
    />
  );
}
