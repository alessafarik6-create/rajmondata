import { handoverCompanyPdfMeta } from "@/lib/handover-protocol-company-pdf";
import { buildHandoverProtocolPdfHtml } from "@/lib/handover-protocol-pdf-html";
import type {
  HandoverProtocolAttachment,
  HandoverProtocolForm,
  HandoverSignatureMeta,
} from "@/lib/handover-protocol-types";

export type HandoverProtocolPdfSnapshot = {
  jobNumber: string;
  jobName: string;
  workContractNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  realizationAddress: string;
  createdAtLabel: string;
  contractorCompanyName: string;
};

export function buildHandoverProtocolHtmlForPreview(params: {
  companyDoc: Record<string, unknown> | null | undefined;
  snapshot: HandoverProtocolPdfSnapshot;
  form: HandoverProtocolForm;
  protocolNumber?: string;
  contractorSignature?: HandoverSignatureMeta | null;
  customerSignature?: HandoverSignatureMeta | null;
  attachments?: HandoverProtocolAttachment[] | { fileName: string }[];
}): string {
  const company = handoverCompanyPdfMeta(params.companyDoc);
  const orgSig = params.companyDoc?.organizationSignature as
    | { url?: string; signedByName?: string }
    | undefined;
  const atts = (params.attachments ?? []).map((a) => ({
    fileName: "fileName" in a ? a.fileName : "",
  }));

  return buildHandoverProtocolPdfHtml({
    snapshot: {
      ...params.snapshot,
      contractorCompanyName:
        params.snapshot.contractorCompanyName || company.contractorCompanyName,
    },
    form: params.form,
    protocolNumber: params.protocolNumber?.trim() || params.form.protocolNumber || "—",
    contractorSignature: params.contractorSignature,
    customerSignature: params.customerSignature,
    organizationSignatureUrl: orgSig?.url ?? null,
    organizationStampName: orgSig?.signedByName ?? null,
    attachments: atts,
    logoUrl: company.logoUrl,
    companyAddressText: company.companyAddressText,
  });
}
