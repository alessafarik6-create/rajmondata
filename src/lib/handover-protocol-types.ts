/**
 * Předávací protokol — navázaný na zakázku, zákazníka a smlouvu o dílo.
 */

export const HANDOVER_PROTOCOL_COLLECTION = "handoverProtocols";

export type HandoverDefectStatus = "open" | "in_progress" | "resolved";

export type HandoverDefectRow = {
  id: string;
  description: string;
  removalDeadline: string;
  status: HandoverDefectStatus;
};

export type HandoverProtocolStatus =
  | "draft"
  | "sent"
  | "signed_by_customer"
  | "signed_by_contractor"
  | "completed";

export type HandoverSignatureMeta = {
  signedAt?: unknown;
  signedByUid?: string | null;
  signedByName?: string | null;
  signedByRole?: string | null;
  signatureImageUrl?: string | null;
  signatureStoragePath?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
};

export type HandoverProtocolAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  storagePath?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdAt?: unknown;
  createdBy?: string | null;
  visibleToCustomer?: boolean;
};

export type HandoverProtocolHistoryEvent = {
  at: string | unknown;
  action: string;
  byUserId?: string | null;
  byDisplayName?: string | null;
  detail?: string | null;
};

export type HandoverProtocolForm = {
  documentTitle: string;
  handoverDateLabel: string;
  deliveredWork: string;
  completedWorkDescription: string;
  handoverNote: string;
  defects: HandoverDefectRow[];
  handedDocumentation: string;
  handedManuals: string;
  handedKeys: string;
  otherHandedItems: string;
  acceptanceText: string;
  protocolNumber: string;
  /** Zobrazit podpisy z portálu v PDF; vypnuto = prázdné rámečky pro ruční podpis. */
  useElectronicSignatures?: boolean;
  /** Zobrazit sekci vad a nedodělků v PDF. */
  showDefects?: boolean;
};

export type HandoverCustomerNote = {
  id: string;
  text: string;
  at: string | unknown;
  byUserId: string;
  byDisplayName?: string | null;
};

export type HandoverProtocolDoc = {
  id: string;
  companyId: string;
  jobId: string;
  customerId?: string | null;
  workContractId: string;
  protocolNumber?: string | null;
  status: HandoverProtocolStatus;
  sharedWithCustomer: boolean;
  sentToCustomer?: boolean;
  /** Snapshot při vytvoření — bez finančních údajů */
  jobNumber?: string | null;
  jobName?: string | null;
  workContractNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  realizationAddress?: string | null;
  createdAtLabel?: string | null;
  contractorCompanyName?: string | null;
  form: HandoverProtocolForm;
  contractorSignature?: HandoverSignatureMeta | null;
  customerSignature?: HandoverSignatureMeta | null;
  attachments?: HandoverProtocolAttachment[];
  customerNotes?: HandoverCustomerNote[];
  shareHistory?: HandoverProtocolHistoryEvent[];
  emailSendHistory?: HandoverProtocolHistoryEvent[];
  activityHistory?: HandoverProtocolHistoryEvent[];
  pdfHtml?: string | null;
  pdfSavedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy: string;
  createdByName?: string | null;
  updatedBy?: string | null;
};

export const HANDOVER_DEFECT_STATUS_LABELS: Record<HandoverDefectStatus, string> = {
  open: "Neodstraněno",
  in_progress: "Rozpracováno",
  resolved: "Odstraněno",
};

export const HANDOVER_PROTOCOL_STATUS_LABELS: Record<HandoverProtocolStatus, string> = {
  draft: "Koncept",
  sent: "Odesláno",
  signed_by_customer: "Podepsáno zákazníkem",
  signed_by_contractor: "Podepsáno zhotovitelem",
  completed: "Dokončeno",
};

export function newHandoverDefectRow(): HandoverDefectRow {
  return {
    id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: "",
    removalDeadline: "",
    status: "open",
  };
}

export function handoverProtocolFormFromDoc(
  data: Record<string, unknown> | null | undefined
): HandoverProtocolForm {
  const f = (data?.form ?? data) as Record<string, unknown> | undefined;
  const defectsRaw = Array.isArray(f?.defects) ? f!.defects : [];
  const defects: HandoverDefectRow[] = defectsRaw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const status = String(o.status ?? "open") as HandoverDefectStatus;
      return {
        id: String(o.id ?? newHandoverDefectRow().id),
        description: String(o.description ?? ""),
        removalDeadline: String(o.removalDeadline ?? ""),
        status:
          status === "in_progress" || status === "resolved" ? status : "open",
      };
    })
    .filter(Boolean) as HandoverDefectRow[];

  return {
    documentTitle: String(f?.documentTitle ?? data?.documentTitle ?? "Předávací protokol").trim(),
    handoverDateLabel: String(f?.handoverDateLabel ?? "").trim(),
    deliveredWork: String(f?.deliveredWork ?? "").trim(),
    completedWorkDescription: String(f?.completedWorkDescription ?? "").trim(),
    handoverNote: String(f?.handoverNote ?? "").trim(),
    defects,
    handedDocumentation: String(f?.handedDocumentation ?? "").trim(),
    handedManuals: String(f?.handedManuals ?? "").trim(),
    handedKeys: String(f?.handedKeys ?? "").trim(),
    otherHandedItems: String(f?.otherHandedItems ?? "").trim(),
    acceptanceText: String(f?.acceptanceText ?? data?.acceptanceText ?? "").trim(),
    protocolNumber: String(f?.protocolNumber ?? data?.protocolNumber ?? "").trim(),
    useElectronicSignatures: f?.useElectronicSignatures !== false,
    showDefects: f?.showDefects !== false,
  };
}

export function defaultHandoverAcceptanceText(): string {
  return `Objednatel potvrzuje převzetí díla v rozsahu sjednaném ve smlouvě o dílo.

Dílo bylo předáno a převzato dne uvedeného v tomto předávacím protokolu.

Objednatel potvrzuje, že převzal veškerou dokumentaci, návody a byl seznámen s obsluhou a údržbou díla.`;
}

export function defaultHandoverProtocolForm(): HandoverProtocolForm {
  const today = new Intl.DateTimeFormat("cs-CZ").format(new Date());
  return {
    documentTitle: "Předávací protokol",
    handoverDateLabel: today,
    deliveredWork: "",
    completedWorkDescription: "",
    handoverNote: "",
    defects: [],
    handedDocumentation: "",
    handedManuals: "",
    handedKeys: "",
    otherHandedItems: "",
    acceptanceText: "",
    protocolNumber: "",
    useElectronicSignatures: true,
    showDefects: true,
  };
}
