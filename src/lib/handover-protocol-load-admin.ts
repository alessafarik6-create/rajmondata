import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { buildHandoverProtocolPdfHtml } from "@/lib/handover-protocol-pdf-html";
import {
  handoverProtocolFormFromDoc,
  type HandoverProtocolAttachment,
} from "@/lib/handover-protocol-types";

export async function loadHandoverProtocolPdfHtml(
  db: Firestore,
  companyId: string,
  protocolId: string
): Promise<
  | { ok: true; html: string; filename: string; protocol: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const pref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("handoverProtocols").doc(protocolId);
  const [protocolSnap, companySnap] = await Promise.all([
    pref.get(),
    db.collection(COMPANIES_COLLECTION).doc(companyId).get(),
  ]);
  if (!protocolSnap.exists) {
    return { ok: false, error: "Předávací protokol neexistuje." };
  }
  const rec = (protocolSnap.data() ?? {}) as Record<string, unknown>;
  const company = (companySnap.data() ?? {}) as Record<string, unknown>;
  const orgSig = company.organizationSignature as { url?: string; signedByName?: string } | undefined;
  const form = handoverProtocolFormFromDoc(rec);
  const attachments = (Array.isArray(rec.attachments) ? rec.attachments : []) as HandoverProtocolAttachment[];

  const html = buildHandoverProtocolPdfHtml({
    snapshot: {
      jobNumber: String(rec.jobNumber ?? ""),
      jobName: String(rec.jobName ?? ""),
      workContractNumber: String(rec.workContractNumber ?? ""),
      customerName: String(rec.customerName ?? ""),
      customerPhone: String(rec.customerPhone ?? ""),
      customerEmail: String(rec.customerEmail ?? ""),
      realizationAddress: String(rec.realizationAddress ?? ""),
      createdAtLabel: String(rec.createdAtLabel ?? ""),
      contractorCompanyName: String(rec.contractorCompanyName ?? ""),
    },
    form,
    protocolNumber: String(rec.protocolNumber ?? form.protocolNumber ?? protocolId),
    contractorSignature: rec.contractorSignature as never,
    customerSignature: rec.customerSignature as never,
    organizationSignatureUrl: orgSig?.url ?? null,
    organizationStampName: orgSig?.signedByName ?? null,
    attachments: attachments.map((a) => ({ fileName: a.fileName })),
  });

  const num = String(rec.protocolNumber ?? protocolId).replace(/[^\w.\-]+/g, "_");
  return { ok: true, html, filename: `predavaci-protokol-${num}.pdf`, protocol: rec };
}
