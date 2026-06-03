"use client";

import React, { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { PortalInvoicePreviewDialog } from "@/components/invoices/portal-invoice-preview-dialog";
import { buildHandoverProtocolPdfHtml } from "@/lib/handover-protocol-pdf-html";
import {
  handoverProtocolFormFromDoc,
  type HandoverProtocolAttachment,
  type HandoverProtocolDoc,
} from "@/lib/handover-protocol-types";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function HandoverProtocolPdfPreviewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  protocol: HandoverProtocolDoc | null;
  companyDoc: Record<string, unknown> | null;
  user?: User | null;
  onSendEmail?: () => void;
  showSendEmail?: boolean;
}) {
  const { open, onOpenChange, protocol, companyDoc, user, onSendEmail, showSendEmail } = props;
  const { toast } = useToast();
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !protocol) {
      setHtml("");
      return;
    }
    setLoading(true);
    try {
      const form = handoverProtocolFormFromDoc(protocol as unknown as Record<string, unknown>);
      const orgSig = companyDoc?.organizationSignature as
        | { url?: string; signedByName?: string }
        | undefined;
      const attachments = (protocol.attachments ?? []) as HandoverProtocolAttachment[];
      const built = buildHandoverProtocolPdfHtml({
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
        organizationSignatureUrl: orgSig?.url ?? null,
        organizationStampName: orgSig?.signedByName ?? null,
        attachments: attachments.map((a) => ({ fileName: a.fileName })),
      });
      setHtml(built);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Náhled PDF",
        description: e instanceof Error ? e.message : "Nelze sestavit náhled.",
      });
      setHtml("");
    } finally {
      setLoading(false);
    }
  }, [open, protocol, companyDoc, toast]);

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
      title={protocol?.form?.documentTitle ?? "Předávací protokol"}
      user={user}
      onSendEmail={onSendEmail}
      showSendEmail={showSendEmail}
    />
  );
}
