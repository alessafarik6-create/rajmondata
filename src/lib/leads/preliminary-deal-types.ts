export const PRELIMINARY_DEAL_STATUSES = [
  "predjednano",
  "ceka_na_potvrzeni",
  "potvrzeno",
  "prevedeno_do_zakazky",
  "odlozeno",
  "zruseno",
] as const;

export type PreliminaryDealStatus = (typeof PRELIMINARY_DEAL_STATUSES)[number];

export const PRELIMINARY_DEAL_STATUS_LABELS: Record<PreliminaryDealStatus, string> = {
  predjednano: "Předjednáno",
  ceka_na_potvrzeni: "Čeká na potvrzení",
  potvrzeno: "Potvrzeno",
  prevedeno_do_zakazky: "Převedeno do zakázky",
  odlozeno: "Odloženo",
  zruseno: "Zrušeno",
};

export type PreliminaryDealPriceVatMode = "with_vat" | "without_vat";

export type PreliminaryDealAttachment = {
  id: string;
  fileName: string;
  storagePath: string;
  downloadUrl?: string;
  sizeBytes?: number;
  uploadedAt?: string;
};

export type PreliminaryDealDoc = {
  companyId: string;
  title: string;
  description: string;
  priceAmount: number;
  priceVatMode: PreliminaryDealPriceVatMode;
  status: PreliminaryDealStatus;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  expectedCompletionDate?: string | null;
  expectedConfirmationDate?: string | null;
  note?: string | null;
  responsibleEmployeeId?: string | null;
  responsibleEmployeeName?: string | null;
  sourceLeadId?: string | null;
  convertedJobId?: string | null;
  convertedAt?: unknown;
  attachments?: PreliminaryDealAttachment[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  updatedBy?: string | null;
};

export function isPreliminaryDealStatus(v: unknown): v is PreliminaryDealStatus {
  return typeof v === "string" && (PRELIMINARY_DEAL_STATUSES as readonly string[]).includes(v);
}

export function normalizePreliminaryDealStatus(v: unknown): PreliminaryDealStatus {
  return isPreliminaryDealStatus(v) ? v : "predjednano";
}

export function preliminaryDealPriceLabel(amount: number, mode: PreliminaryDealPriceVatMode): string {
  const n = Number(amount);
  const base = Number.isFinite(n) ? n.toLocaleString("cs-CZ") : "—";
  return mode === "with_vat" ? `${base} Kč s DPH` : `${base} Kč bez DPH`;
}
