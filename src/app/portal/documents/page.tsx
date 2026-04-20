"use client";

import React, {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
import {
  Plus,
  FileText,
  Upload,
  Download,
  Filter,
  Search,
  Loader2,
  Trash2,
  FileDown,
  Briefcase,
  ImageIcon,
  ExternalLink,
  Pencil,
  Link2,
  ReceiptText,
  Printer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import {
  doc,
  collection,
  addDoc,
  arrayRemove,
  arrayUnion,
  setDoc,
  serverTimestamp,
  deleteField,
  getDoc,
  query,
  updateDoc,
  where,
  type DocumentData,
  type UpdateData,
} from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JOB_EXPENSE_DOCUMENT_SOURCE } from "@/lib/job-expense-document-sync";
import {
  reconcileCompanyDocumentJobExpense,
  type CompanyDocumentExpenseReconcileBefore,
} from "@/lib/document-job-expense-sync";
import { reconcileCompanyDocumentJobIncome } from "@/lib/document-job-income-sync";
import { JOB_MEDIA_DOCUMENT_SOURCE } from "@/lib/job-linked-document-sync";
import {
  inferJobMediaItemType,
  getJobMediaFileTypeFromFile,
  isAllowedJobMediaFile,
  type JobMediaFileType,
} from "@/lib/job-media-types";
import { uploadJobPhotoFileViaFirebaseSdk } from "@/lib/job-photo-upload";
import { isFinancialCompanyDocument } from "@/lib/company-documents-financial";
import {
  companyDocumentMatchesAssignedJobFilter,
  companyDocumentMatchesJobFilterRow,
  companyDocumentMatchesUnassignedJobFilter,
  documentJobLinkId,
  documentLinkedJobIds,
  documentShowsAsPendingAssignment,
  effectiveCompanyDocumentAssignmentTypeForForm,
  resolveDocumentAssignmentBadge,
} from "@/lib/company-document-assignment";
import {
  allocationBasisGrossCzk,
  allocationJobIdsFromRows,
  allocationsMirrorForDocument,
  computeAllocationGrossCzkShares,
  makeJobCostAllocationId,
  resolveJobCostAllocationsFromDocument,
  validateJobCostAllocations,
  type JobCostAllocationMode,
  type JobCostAllocationRow,
} from "@/lib/company-document-job-allocations";
import {
  compareDocumentsForPaymentQueue,
  documentGrossForPayment,
  getDocumentPaymentUrgency,
  getPortalInvoicePaymentUrgency,
  isDocumentEligibleForPaymentBox,
  paymentStatusBadgeClass,
  paymentStatusLabel,
  resolveCompanyDocumentPaymentStatus,
  type CompanyDocumentPaymentRow,
  urgencyLabel,
} from "@/lib/company-document-payment";
import {
  getDocumentStatusStyle,
  getInvoiceDocumentStatusStyle,
} from "@/lib/company-document-row-highlight";
import { cn } from "@/lib/utils";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { logActivitySafe } from "@/lib/activity-log";
import {
  calculateVatAmountsFromNet,
  normalizeVatRate,
  VAT_RATE_OPTIONS,
  roundMoney2,
} from "@/lib/vat-calculations";
import {
  amountsToCzk,
  grossOriginal,
} from "@/lib/company-document-czk";
import { resolveEurCzkRate } from "@/lib/exchange-rate-eur-czk";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";
import { PORTAL_MANUAL_INVOICE_TYPE } from "@/lib/portal-manual-invoice";
import { printInvoiceHtmlDocument } from "@/lib/print-html";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type CompanyDocumentRow = {
  id: string;
  type?: string;
  documentKind?: string;
  source?: string;
  sourceType?: string;
  documentType?: "invoice" | "document" | "delivery_note";
  sourceId?: string;
  sourceLabel?: string;
  jobLinkedKind?: string;
  folderId?: string;
  jobId?: string;
  jobName?: string | null;
  /** Alias k jobId pro přiřazení k zakázce. */
  zakazkaId?: string;
  number?: string;
  entityName?: string;
  /** Zobrazovaný název dokladu (preferováno před entityName). */
  nazev?: string;
  amount?: number;
  amountNet?: number;
  amountGross?: number;
  vatAmount?: number;
  vatRate?: number;
  vat?: number;
  /** Uložená částka podle režimu DPH (kompatibilní s novým modelem). */
  castka?: number;
  /** Měna vstupu (původní částky v `castka` / `amountNet` / …). */
  currency?: "CZK" | "EUR";
  /** Hrubá částka v původní měně (stejná soustava jako `castka`). */
  amountOriginal?: number;
  /** Kurz CZK za 1 EUR v okamžiku uložení (u CZK obvykle nevyplněno). */
  exchangeRate?: number;
  /** Hrubá částka v CZK (shodně s `castkaCZK` / `amountGrossCZK`). */
  amountCZK?: number;
  castkaCZK?: number;
  amountNetCZK?: number;
  amountGrossCZK?: number;
  vatAmountCZK?: number;
  sDPH?: boolean;
  dphSazba?: number;
  date?: string;
  description?: string;
  note?: string | null;
  poznamka?: string | null;
  fileUrl?: string | null;
  fileType?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  storagePath?: string | null;
  createdAt?: unknown;
  uploadedBy?: string;
  uploadedByName?: string;
  assignmentType?: AssignmentType;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  assignedTo?: {
    jobId?: string | null;
    companyId?: string | null;
    warehouseId?: string | null;
  } | null;
  /** ID záznamu v jobs/.../expenses pro primární doklad (ne zrcadlo jobExpense_*). */
  linkedExpenseId?: string | null;
  /** ID záznamu v jobs/.../incomes odpovídá ID dokladu (vydaný příjem k zakázce). */
  linkedIncomeId?: string | null;
  /** Doklad má být uhrazen (přehled Nutno uhradit). */
  requiresPayment?: boolean;
  /** Splatnost (YYYY-MM-DD). */
  dueDate?: string | null;
  paid?: boolean;
  paidAt?: unknown;
  paidBy?: string | null;
  paymentStatus?: "unpaid" | "partial" | "paid" | null;
  paidAmount?: number | null;
  paymentMethod?: "cash" | "bank" | "card" | "other" | null;
  paymentNote?: string | null;
  /** Měkké smazání — doklad zůstává ve Firestore. */
  isDeleted?: boolean;
  /** Volitelné — klasifikace / fronta nezařazených (když existuje v datech). */
  unassigned?: boolean | null;
  classificationStatus?: string | null;
  /** Rozdělení nákladů přijatého dokladu mezi zakázky / režii. */
  jobCostAllocations?: unknown;
  jobCostAllocationMode?: JobCostAllocationMode;
  /** Stejné významy jako `jobCostAllocationMode` (zrcadlo pro export / čitelnost). */
  allocationMode?: JobCostAllocationMode;
  /** Zjednodušené řádky { jobId, percent, amount, note } — zrcadlo k `jobCostAllocations`. */
  allocations?: unknown;
  allocationJobIds?: string[];
};

type AssignmentType =
  | "job_cost"
  | "company"
  | "warehouse"
  | "overhead"
  | "pending_assignment";

function inferSDPH(row: CompanyDocumentRow): boolean {
  if (typeof row.sDPH === "boolean") return row.sDPH;
  const va = Number(row.vatAmount ?? 0);
  const vr = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 0);
  return va > 0 || vr > 0;
}

function docDisplayTitle(row: CompanyDocumentRow): string {
  const n =
    row.nazev?.trim() ||
    row.entityName?.trim() ||
    row.number?.trim() ||
    row.fileName?.trim() ||
    "";
  return n || row.id;
}

function docVatInfoLine(row: CompanyDocumentRow): string {
  if (!inferSDPH(row)) return "bez DPH";
  const r = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  const rate = Number.isFinite(r) ? r : 21;
  return `s DPH ${rate} %`;
}

function formatDocMoney(n: number, currency: "CZK" | "EUR"): string {
  const s = roundMoney2(n).toLocaleString("cs-CZ");
  return currency === "EUR" ? `${s} €` : `${s} Kč`;
}

function invoiceDocTypeLabel(inv: Record<string, unknown>): string {
  const t = String(inv.type ?? "");
  if (t === JOB_INVOICE_TYPES.ADVANCE) return "Zálohová faktura";
  if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) return "Daňový doklad (platba)";
  if (t === JOB_INVOICE_TYPES.FINAL_INVOICE) return "Vyúčtovací faktura";
  if (t === PORTAL_MANUAL_INVOICE_TYPE) return "Faktura (portál)";
  return "Faktura";
}

function openInvoicePrintFromRow(
  inv: Record<string, unknown>,
  toast: (o: {
    variant?: "destructive";
    title: string;
    description: string;
  }) => void
) {
  const html = inv.pdfHtml;
  if (typeof html !== "string" || !html.trim()) {
    toast({
      variant: "destructive",
      title: "Nelze tisknout",
      description: "U dokladu není uložený náhled (pdfHtml).",
    });
    return;
  }
  const title = String(inv.invoiceNumber || inv.documentNumber || "Doklad");
  const r = printInvoiceHtmlDocument(html, title);
  if (r === "blocked") {
    toast({
      variant: "destructive",
      title: "Tisk byl zablokován",
      description: "Povolte vyskakovací okna pro tento web.",
    });
  }
}

/**
 * Zobrazení částek — respektuje vlastní sazbu DPH (např. 15 %), nejen 0/12/21.
 * U EUR dokladů jsou `amountNet` / `castka` v eurech; `amountGrossCZK` je přepočet.
 */
function docDisplayAmounts(row: CompanyDocumentRow): {
  amountNet: number;
  vatAmount: number;
  amountGross: number;
  label: string;
  currency: "CZK" | "EUR";
  amountGrossCZK: number;
  showCzkHint: boolean;
} {
  const currency: "CZK" | "EUR" = row.currency === "EUR" ? "EUR" : "CZK";
  const czkStored = roundMoney2(
    Number(row.castkaCZK ?? row.amountGrossCZK ?? row.amountCZK ?? 0)
  );

  const sDPH = inferSDPH(row);
  if (!sDPH) {
    const c = roundMoney2(
      Number(
        row.castka ??
          row.amountNet ??
          row.amountGross ??
          row.amount ??
          0
      )
    );
    const grossCzk = czkStored > 0 ? czkStored : c;
    return {
      amountNet: c,
      vatAmount: 0,
      amountGross: c,
      label: "bez DPH",
      currency,
      amountGrossCZK: grossCzk,
      showCzkHint: currency === "EUR" && czkStored > 0,
    };
  }
  const rate = Number(row.dphSazba ?? row.vatRate ?? row.vat ?? 21);
  let net = roundMoney2(Number(row.amountNet ?? row.amount ?? 0));
  let gross = roundMoney2(Number(row.amountGross ?? 0));
  let vat = roundMoney2(Number(row.vatAmount ?? 0));
  const castkaGross = roundMoney2(Number(row.castka ?? 0));
  if (gross <= 0 && castkaGross > 0) gross = castkaGross;
  if (gross <= 0 && net > 0 && Number.isFinite(rate)) {
    vat = roundMoney2((net * rate) / 100);
    gross = roundMoney2(net + vat);
  } else if (net <= 0 && gross > 0 && Number.isFinite(rate) && rate > 0) {
    net = roundMoney2(gross / (1 + rate / 100));
    vat = roundMoney2(gross - net);
  } else if (vat <= 0 && net > 0 && gross > 0) {
    vat = roundMoney2(gross - net);
  }
  const grossCzk = czkStored > 0 ? czkStored : gross;
  return {
    amountNet: net,
    vatAmount: vat,
    amountGross: gross,
    label: `s DPH ${Number.isFinite(rate) ? rate : 21} %`,
    currency,
    amountGrossCZK: grossCzk,
    showCzkHint: currency === "EUR" && czkStored > 0,
  };
}

function parseVatPercentInput(raw: string): number {
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

type EditJobCostAllocFormRow = {
  id: string;
  kind: "job" | "overhead";
  jobId: string;
  amount: string;
  percent: string;
  note: string;
  linkedExpenseId?: string | null;
};

/** Hrubá částka v CZK po úpravách ve formuláři (pro validaci rozdělení; EUR bez uloženého kurzu použije hrubý odhad). */
function previewEditDocumentGrossCzk(
  editRow: CompanyDocumentRow,
  editForm: {
    castka: string;
    currency: "CZK" | "EUR";
    sDPH: boolean;
    dphSazba: string;
  }
): number {
  const castkaNum = Number(String(editForm.castka).replace(",", "."));
  if (!Number.isFinite(castkaNum) || castkaNum <= 0) return 0;
  const dphPct = parseVatPercentInput(editForm.dphSazba);
  const docCurrency = editForm.currency === "EUR" ? "EUR" : "CZK";
  let rateEurCzk = 1;
  if (docCurrency === "EUR") {
    const stored = Number(editRow.exchangeRate ?? 0);
    rateEurCzk =
      Number.isFinite(stored) && stored > 0 ? stored : 25;
  }
  if (editForm.sDPH) {
    const net = roundMoney2(castkaNum);
    const vatAmount = roundMoney2((net * dphPct) / 100);
    const gross = roundMoney2(net + vatAmount);
    return amountsToCzk(docCurrency, rateEurCzk, {
      amountNet: net,
      vatAmount,
      amountGross: gross,
    }).castkaCZK;
  }
  const c = roundMoney2(castkaNum);
  return amountsToCzk(docCurrency, rateEurCzk, {
    amountNet: c,
    vatAmount: 0,
    amountGross: c,
  }).castkaCZK;
}

function editAllocFormRowsToDomain(
  rows: EditJobCostAllocFormRow[]
): JobCostAllocationRow[] {
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    jobId: r.kind === "job" && r.jobId.trim() ? r.jobId.trim() : null,
    amount:
      r.amount.trim() === ""
        ? null
        : roundMoney2(Number(String(r.amount).replace(",", "."))),
    percent:
      r.percent.trim() === ""
        ? null
        : Number(String(r.percent).replace(",", ".")),
    note: r.note.trim() || null,
    linkedExpenseId: r.linkedExpenseId?.trim() || null,
  }));
}

function isReceivedDoc(d: CompanyDocumentRow) {
  if (d.documentType === "delivery_note") return true;
  return (
    d.type === "received" ||
    d.documentKind === "prijate" ||
    (d.type !== "issued" &&
      d.type !== "vydane" &&
      d.documentKind !== "vydane")
  );
}

function docCreatedAtMs(t: unknown): number {
  if (t && typeof (t as { toMillis?: () => number }).toMillis === "function") {
    return (t as { toMillis: () => number }).toMillis();
  }
  if (t && typeof (t as { seconds?: number }).seconds === "number") {
    return (t as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function inferDocRowFileKind(
  row: CompanyDocumentRow
): JobMediaFileType | "none" {
  if (!row.fileUrl?.trim()) return "none";
  return inferJobMediaItemType(row);
}

function isDeliveryNote(row: CompanyDocumentRow): boolean {
  return (
    row.documentType === "delivery_note" ||
    row.type === "delivery_note" ||
    row.documentKind === "delivery_note"
  );
}

function ReceivedDocJobColumnCell({
  row,
  jobNamesById,
  showPendingHighlight,
}: {
  row: CompanyDocumentRow;
  jobNamesById: Map<string, string>;
  showPendingHighlight: boolean;
}) {
  const { usesExplicitAllocations, rows, mode } =
    resolveJobCostAllocationsFromDocument(row);
  const basis = allocationBasisGrossCzk(
    row as Parameters<typeof allocationBasisGrossCzk>[0]
  );

  if (usesExplicitAllocations && rows.length > 0) {
    const shares = computeAllocationGrossCzkShares({
      mode,
      rows,
      basisGrossCzk: basis,
    });
    return (
      <div className="space-y-1 text-[11px] leading-snug sm:text-xs">
        {rows.map((r) => {
          const gross = shares.get(r.id) ?? 0;
          const pctLabel =
            mode === "percent" &&
            r.percent != null &&
            Number.isFinite(Number(r.percent))
              ? ` (${roundMoney2(Number(r.percent))} %)`
              : "";
          if (r.kind === "overhead") {
            return (
              <div key={r.id} className="break-words text-gray-800">
                <span className="font-medium text-amber-900">Režie</span>
                <span className="tabular-nums text-gray-600">
                  {" "}
                  · {formatDocMoney(gross, "CZK")}
                  {pctLabel}
                </span>
                {r.note?.trim() ? (
                  <span className="mt-0.5 block truncate text-gray-600" title={r.note ?? ""}>
                    Pozn.: {r.note}
                  </span>
                ) : null}
              </div>
            );
          }
          const jid = r.jobId?.trim() ?? "";
          const name =
            jobNamesById.get(jid) ||
            row.jobName ||
            row.entityName ||
            jid ||
            "Zakázka";
          if (jid) {
            return (
              <div key={r.id} className="min-w-0 break-words">
                <Link
                  href={`/portal/jobs/${jid}`}
                  className="font-medium text-blue-800 underline-offset-2 hover:underline"
                >
                  {name}
                </Link>
                <span className="tabular-nums text-gray-700">
                  {" "}
                  · {formatDocMoney(gross, "CZK")}
                  {pctLabel}
                </span>
                {r.note?.trim() ? (
                  <span className="mt-0.5 block truncate text-gray-600" title={r.note ?? ""}>
                    Pozn.: {r.note}
                  </span>
                ) : null}
              </div>
            );
          }
          return (
            <div key={r.id} className="text-gray-700">
              Zakázka (nevybráno)
              <span className="tabular-nums">
                {" "}
                · {formatDocMoney(gross, "CZK")}
                {pctLabel}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const jobLinkId = documentJobLinkId(row);
  if (jobLinkId) {
    return (
      <Link
        href={`/portal/jobs/${jobLinkId}`}
        className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
        title={row.jobName ?? row.entityName ?? ""}
      >
        {row.jobName || row.entityName || "Zakázka"}
      </Link>
    );
  }
  return (
    <span className="text-gray-800 line-clamp-2 break-words">
      {showPendingHighlight
        ? "Doklad není zařazen"
        : row.assignmentType === "warehouse"
          ? "Sklad"
          : row.assignmentType === "company" ||
              row.assignmentType === "overhead"
            ? "Firma"
            : row.entityName ?? "—"}
    </span>
  );
}

/** Tabulkový přehled rozdělení nákladu přímo pod řádkem dokladu v seznamu. */
function DocumentCostAllocationDetail({
  row,
  jobNamesById,
}: {
  row: CompanyDocumentRow;
  jobNamesById: Map<string, string>;
}) {
  const { usesExplicitAllocations, rows, mode } =
    resolveJobCostAllocationsFromDocument(row);
  if (!usesExplicitAllocations || rows.length === 0) return null;
  const basis = allocationBasisGrossCzk(
    row as Parameters<typeof allocationBasisGrossCzk>[0]
  );
  if (basis <= 0) return null;
  const shares = computeAllocationGrossCzkShares({
    mode,
    rows,
    basisGrossCzk: basis,
  });
  return (
    <div className="border-b border-gray-200 bg-slate-50/90 px-3 py-2 lg:px-2">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
        Rozdělení nákladu na zakázky
      </p>
      <div className="overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="w-full min-w-[280px] border-collapse text-[11px] text-gray-900">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left">
              <th className="px-2 py-1 font-medium">Cíl / zakázka</th>
              <th className="px-2 py-1 font-medium tabular-nums">Částka (CZK)</th>
              <th className="px-2 py-1 font-medium tabular-nums">% z dokladu</th>
              <th className="px-2 py-1 font-medium">Poznámka</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gross = shares.get(r.id) ?? 0;
              const pctFromInput =
                mode === "percent" &&
                r.percent != null &&
                Number.isFinite(Number(r.percent))
                  ? roundMoney2(Number(r.percent))
                  : basis > 0
                    ? roundMoney2((gross / basis) * 100)
                    : 0;
              const note = r.note?.trim() ?? "";
              if (r.kind === "overhead") {
                return (
                  <tr key={r.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-2 py-1 font-medium text-amber-950">Režie</td>
                    <td className="px-2 py-1 tabular-nums">
                      {formatDocMoney(gross, "CZK")}
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {pctFromInput.toLocaleString("cs-CZ")} %
                    </td>
                    <td
                      className="max-w-[10rem] truncate px-2 py-1 text-gray-700"
                      title={note}
                    >
                      {note || "—"}
                    </td>
                  </tr>
                );
              }
              const jid = r.jobId?.trim() ?? "";
              const name =
                (jid ? jobNamesById.get(jid) : null) ||
                row.jobName ||
                jid ||
                "Zakázka";
              return (
                <tr key={r.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-2 py-1">
                    {jid ? (
                      <Link
                        href={`/portal/jobs/${jid}`}
                        className="font-medium text-blue-800 underline-offset-2 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {formatDocMoney(gross, "CZK")}
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {pctFromInput.toLocaleString("cs-CZ")} %
                  </td>
                  <td
                    className="max-w-[10rem] truncate px-2 py-1 text-gray-700"
                    title={note}
                  >
                    {note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-gray-100 bg-gray-50 px-2 py-1 text-[10px] text-gray-700">
          Režim zápisu: {mode === "percent" ? "procenta" : "částky"} · Celková částka dokladu
          (základ rozdělení):{" "}
          <span className="font-semibold tabular-nums text-gray-900">
            {formatDocMoney(basis, "CZK")}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Stejný limit jako u nahrávání médií na kartě zakázky. */
const MAX_JOB_PHOTO_BYTES = 20 * 1024 * 1024;

function issuedMergedEntryMatchesPaymentFilter(
  entry:
    | { kind: "doc"; row: CompanyDocumentRow }
    | { kind: "inv"; inv: Record<string, unknown> & { id: string } },
  paymentFilter: string,
  todayIso: string
): boolean {
  if (paymentFilter === "__all__") return true;
  if (entry.kind === "doc") {
    const pr = entry.row as CompanyDocumentPaymentRow;
    const u = getDocumentPaymentUrgency(pr, todayIso);
    if (paymentFilter === "to_pay") return isDocumentEligibleForPaymentBox(pr);
    if (paymentFilter === "needs_flag") return pr.requiresPayment === true;
    if (paymentFilter === "paid") return pr.paid === true;
    if (paymentFilter === "unpaid") return pr.paid !== true;
    if (paymentFilter === "overdue") return u === "overdue";
    if (paymentFilter === "due_soon") return u === "due_soon";
    return true;
  }
  const inv = entry.inv;
  const u = getPortalInvoicePaymentUrgency(inv, todayIso);
  const gross = Number(inv.amountGross ?? inv.totalAmount ?? 0);
  if (paymentFilter === "to_pay") {
    return u !== "paid" && u !== "not_applicable" && Number.isFinite(gross) && gross > 0;
  }
  if (paymentFilter === "needs_flag") return false;
  if (paymentFilter === "paid") return u === "paid";
  if (paymentFilter === "unpaid") return u !== "paid" && u !== "not_applicable";
  if (paymentFilter === "overdue") return u === "overdue";
  if (paymentFilter === "due_soon") return u === "due_soon";
  return true;
}

type OverduePaymentSection = "received" | "issued";

type OverduePaymentFlashTarget = {
  flashRowKey: string;
  due: string;
  section: OverduePaymentSection;
};

function isIssuedFinancialDocRow(d: CompanyDocumentRow): boolean {
  return (
    d.type === "issued" ||
    d.type === "vydane" ||
    d.documentKind === "vydane"
  );
}

function overduePaymentSectionForDoc(
  d: CompanyDocumentRow
): OverduePaymentSection | null {
  if (isReceivedDoc(d)) return "received";
  if (isIssuedFinancialDocRow(d)) return "issued";
  return null;
}

/**
 * Jednotná množina položek „po splatnosti“ pro badge, kliknutí a filtr tabulek
 * (getDocumentPaymentUrgency / getPortalInvoicePaymentUrgency === overdue).
 */
function collectOverduePaymentFlashTargets(
  financialActive: CompanyDocumentRow[],
  invoices: Array<Record<string, unknown> & { id: string }>,
  todayIso: string
): OverduePaymentFlashTarget[] {
  const out: OverduePaymentFlashTarget[] = [];
  for (const d of financialActive) {
    const pr = d as CompanyDocumentPaymentRow;
    if (getDocumentPaymentUrgency(pr, todayIso) !== "overdue") continue;
    const sec = overduePaymentSectionForDoc(d);
    if (!sec) continue;
    out.push({
      flashRowKey: `doc:${d.id}`,
      due: String(d.dueDate ?? "").trim() || "9999-12-31",
      section: sec,
    });
  }
  for (const inv of invoices) {
    if (getPortalInvoicePaymentUrgency(inv, todayIso) !== "overdue") continue;
    out.push({
      flashRowKey: `inv:${inv.id}`,
      due: String(inv.dueDate ?? "").trim() || "9999-12-31",
      section: "issued",
    });
  }
  out.sort(
    (a, b) =>
      a.due.localeCompare(b.due) || a.flashRowKey.localeCompare(b.flashRowKey)
  );
  return out;
}

function pickDocumentsTabForOverdueTargets(
  targets: OverduePaymentFlashTarget[]
): "all" | "received" | "issued" {
  const hasR = targets.some((t) => t.section === "received");
  const hasI = targets.some((t) => t.section === "issued");
  if (hasR && hasI) return "all";
  if (hasR) return "received";
  return "issued";
}

function buildPaymentOverdueScrollDomId(
  tab: "all" | "received" | "issued",
  target: OverduePaymentFlashTarget
): string {
  const sep = target.flashRowKey.indexOf(":");
  const kind = sep >= 0 ? target.flashRowKey.slice(0, sep) : "doc";
  const rawId = sep >= 0 ? target.flashRowKey.slice(sep + 1) : "";
  if (tab === "received") {
    return `payment-flash-received-${kind}-${rawId}`;
  }
  if (tab === "issued") {
    return `payment-flash-issued-${kind}-${rawId}`;
  }
  const block = target.section === "received" ? "received" : "issued";
  return `payment-flash-all-${block}-${kind}-${rawId}`;
}

function DocumentsPageContent() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const documentsMainTab =
    viewParam === "issued" ||
    viewParam === "all" ||
    viewParam === "received" ||
    viewParam === "trash"
      ? viewParam
      : "received";
  const setDocumentsMainTab = (v: string) => {
    router.replace(`/portal/documents?view=${v}`, { scroll: false });
  };

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const documentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "documents");
  }, [firestore, companyId]);

  const { data: documents, isLoading } = useCollection(documentsQuery);
  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "invoices");
  }, [firestore, companyId]);
  const { data: invoicesRaw, isLoading: isInvoicesLoading } =
    useCollection(invoicesQuery);
  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobs");
  }, [firestore, companyId]);
  const { data: jobsRaw } = useCollection(jobsQuery);
  const jobs = useMemo(() => {
    const rows = Array.isArray(jobsRaw) ? jobsRaw : [];
    return rows
      .map((j) => ({
        id: String((j as { id?: string }).id ?? ""),
        name: String(
          (j as { name?: string; title?: string }).name ??
            (j as { title?: string }).title ??
            "Zakázka"
        ).trim(),
      }))
      .filter((j) => j.id);
  }, [jobsRaw]);

  const jobNamesById = useMemo(
    () => new Map(jobs.map((j) => [j.id, j.name] as const)),
    [jobs]
  );

  const [isAddDocOpen, setIsAddDocOpen] = useState(false);
  const [newDocKind, setNewDocKind] = useState<"document" | "delivery_note">(
    "document"
  );
  const [newDocType, setNewDocType] = useState<"received" | "issued">("received");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [assignmentType, setAssignmentType] =
    useState<AssignmentType>("pending_assignment");
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  const [formData, setFormData] = useState({
    number: "",
    entityName: "",
    amount: "",
    currency: "CZK" as "CZK" | "EUR",
    vat: "21",
    date: new Date().toISOString().split("T")[0],
    description: "",
    requiresPayment: false,
    dueDate: "",
    paymentStatus: "unpaid" as "unpaid" | "partial" | "paid",
    paidAmount: "",
    paidAt: "",
    paymentMethod: "bank" as "cash" | "bank" | "card" | "other",
    paymentNote: "",
  });

  const todayIso = useMemo(
    () => new Date().toISOString().split("T")[0],
    []
  );

  const [documentsPaymentFilter, setDocumentsPaymentFilter] =
    useState<string>("__all__");

  useEffect(() => {
    if (documentsMainTab === "trash") {
      setDocumentsPaymentFilter("__all__");
    }
  }, [documentsMainTab]);

  /** Zvýraznění řádku po kliknutí na „Po splatnosti“ v souhrnu (doc:id | inv:id). */
  const [paymentFlashRowKey, setPaymentFlashRowKey] = useState<string | null>(
    null
  );
  /** Remount tabulek = výchozí lokální filtry, ať overdue řádek nezmizí pod kategorií / zakázkou. */
  const [paymentTableMountKey, setPaymentTableMountKey] = useState(0);
  const paymentOverdueScrollRef = useRef<string | null>(null);

  useEffect(() => {
    if (!paymentFlashRowKey) return;
    const t = window.setTimeout(() => setPaymentFlashRowKey(null), 3800);
    return () => window.clearTimeout(t);
  }, [paymentFlashRowKey]);

  useLayoutEffect(() => {
    const id = paymentOverdueScrollRef.current;
    if (!id) return;
    paymentOverdueScrollRef.current = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    });
  }, [
    documentsMainTab,
    documentsPaymentFilter,
    paymentTableMountKey,
    paymentFlashRowKey,
  ]);

  const newDocGrossPreview = useMemo(() => {
    const amountStr = String(formData.amount ?? "").trim();
    const n =
      amountStr === "" ? NaN : Number(String(amountStr).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return 0;
    const docCurrency = formData.currency === "EUR" ? "EUR" : "CZK";
    const vatRate = normalizeVatRate(Number(formData.vat));
    if (docCurrency === "EUR") {
      const net = roundMoney2(n);
      const vatAmount = roundMoney2((net * vatRate) / 100);
      return roundMoney2(net + vatAmount);
    }
    const netInt = Math.round(n);
    const c = calculateVatAmountsFromNet(netInt, vatRate);
    return roundMoney2(c.amountGross);
  }, [formData.amount, formData.currency, formData.vat]);

  const [receivedSearch, setReceivedSearch] = useState("");
  const [issuedSearch, setIssuedSearch] = useState("");
  const [assigningDocId, setAssigningDocId] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTypeNext, setAssignTypeNext] =
    useState<AssignmentType>("pending_assignment");
  const [assignJobIdNext, setAssignJobIdNext] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<CompanyDocumentRow | null>(null);
  const [editInvoiceId, setEditInvoiceId] = useState<string>("");
  const [editAssignmentType, setEditAssignmentType] =
    useState<AssignmentType>("pending_assignment");
  const [editWarehouseId, setEditWarehouseId] = useState<string>("");
  const [editSupplier, setEditSupplier] = useState<string>("");
  const [editForm, setEditForm] = useState({
    nazev: "",
    castka: "",
    currency: "CZK" as "CZK" | "EUR",
    sDPH: true,
    dphSazba: "21",
    date: "",
    poznamka: "",
    zakazkaId: "",
    /** Když není vybraná zakázka: nezařazeno vs. režie. */
    noJobMode: "pending" as "pending" | "overhead",
    requiresPayment: false,
    dueDate: "",
  });
  const [editSplitToJobs, setEditSplitToJobs] = useState(false);
  const [editAllocMode, setEditAllocMode] =
    useState<JobCostAllocationMode>("amount");
  const [editAllocRows, setEditAllocRows] = useState<EditJobCostAllocFormRow[]>(
    []
  );
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CompanyDocumentRow | null>(
    null
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteInvoiceOpen, setDeleteInvoiceOpen] = useState(false);
  const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState(false);

  const canSoftDelete = useMemo(() => {
    const r = String((profile as { role?: string })?.role ?? "");
    const gr = (profile as { globalRoles?: string[] })?.globalRoles;
    return (
      r === "owner" ||
      r === "admin" ||
      (Array.isArray(gr) && gr.includes("super_admin"))
    );
  }, [profile]);

  useEffect(() => {
    if (isProfileLoading) return;
    if (viewParam === "trash" && !canSoftDelete) {
      router.replace("/portal/documents?view=received", { scroll: false });
    }
  }, [viewParam, canSoftDelete, isProfileLoading, router]);

  const financialDocumentsActive = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[]).filter(
        (d) =>
          (isFinancialCompanyDocument(d) || isDeliveryNote(d)) &&
          isActiveFirestoreDoc(d)
      ),
    [documents]
  );

  const financialDocumentsDeleted = useMemo(
    () =>
      ((documents ?? []) as CompanyDocumentRow[]).filter(
        (d) =>
          (isFinancialCompanyDocument(d) || isDeliveryNote(d)) &&
          d.isDeleted === true
      ),
    [documents]
  );

  const financialDocuments =
    documentsMainTab === "trash"
      ? financialDocumentsDeleted
      : financialDocumentsActive;

  const invoicesActiveList = useMemo(() => {
    const raw = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    return raw.filter((inv) =>
      isActiveFirestoreDoc(inv as { isDeleted?: unknown })
    );
  }, [invoicesRaw]);

  const invoicesDeletedList = useMemo(() => {
    const raw = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    return raw.filter(
      (inv) => (inv as { isDeleted?: unknown }).isDeleted === true
    );
  }, [invoicesRaw]);

  const invoicesForCurrentView =
    documentsMainTab === "trash" ? invoicesDeletedList : invoicesActiveList;
  const invoiceSelectOptions = useMemo(() => {
    const raw = Array.isArray(invoicesActiveList) ? invoicesActiveList : [];
    return raw.map((inv) => {
      const id = String((inv as { id?: string }).id ?? "");
      const label = String(
        (inv as { invoiceNumber?: string; documentNumber?: string }).invoiceNumber ??
          (inv as { documentNumber?: string }).documentNumber ??
          id
      ).trim();
      return { id, label: label || id };
    });
  }, [invoicesActiveList]);

  const pendingDocs = useMemo(
    () =>
      financialDocumentsActive
        .filter((d) => documentShowsAsPendingAssignment(d))
        .sort(
          (a, b) => docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt)
        ),
    [financialDocumentsActive]
  );

  const paymentOverviewStats = useMemo(() => {
    const list = financialDocumentsActive as CompanyDocumentPaymentRow[];
    let toPay = 0;
    let totalKc = 0;
    for (const d of list) {
      if (!isDocumentEligibleForPaymentBox(d)) continue;
      toPay += 1;
      totalKc += documentGrossForPayment(d);
    }
    const invList = invoicesActiveList;
    for (const raw of invList) {
      const inv = raw as Record<string, unknown>;
      if (inv.status === "paid") continue;
      const gross = Number(inv.amountGross ?? inv.totalAmount ?? 0);
      if (!Number.isFinite(gross) || gross <= 0) continue;
      toPay += 1;
      totalKc += roundMoney2(gross);
    }
    const overdueTargets = collectOverduePaymentFlashTargets(
      financialDocumentsActive,
      invList as Array<Record<string, unknown> & { id: string }>,
      todayIso
    );
    const overdueDocuments = overdueTargets.filter((t) =>
      t.flashRowKey.startsWith("doc:")
    ).length;
    const overdueInvoices = overdueTargets.filter((t) =>
      t.flashRowKey.startsWith("inv:")
    ).length;
    const overdueTotal = overdueTargets.length;
    return {
      toPay,
      overdueDocuments,
      overdueInvoices,
      overdueTotal,
      totalKc,
      overdueTargets,
    };
  }, [financialDocumentsActive, invoicesActiveList, todayIso]);

  const onPaymentOverdueSummaryClick = useCallback(() => {
    if (paymentOverviewStats.overdueTotal <= 0) {
      toast({
        title: "Žádná položka po splatnosti",
        description:
          "Nemáte doklady ani faktury po splatnosti (neuhrazené se splatností před dneškem).",
      });
      return;
    }
    const targets = paymentOverviewStats.overdueTargets;
    if (targets.length === 0) {
      toast({
        variant: "destructive",
        title: "Neshoda souhrnu a výpisu",
        description:
          "Badge hlásí položky po splatnosti, ale ve výpisu se nenašly žádné odpovídající záznamy. Zkuste obnovit stránku.",
      });
      return;
    }
    setDocumentsPaymentFilter("overdue");
    setReceivedSearch("");
    setIssuedSearch("");
    setPaymentTableMountKey((k) => k + 1);
    const tab = pickDocumentsTabForOverdueTargets(targets);
    const primary = targets[0];
    paymentOverdueScrollRef.current = buildPaymentOverdueScrollDomId(
      tab,
      primary
    );
    setDocumentsMainTab(tab);
    setPaymentFlashRowKey(primary.flashRowKey);
  }, [
    paymentOverviewStats.overdueTargets,
    paymentOverviewStats.overdueTotal,
    toast,
  ]);

  const markDocumentPaid = async (row: CompanyDocumentRow) => {
    if (!companyId || !firestore || !user) return;
    const todayIso = new Date().toISOString().split("T")[0];
    const gross = documentGrossForPayment(row as CompanyDocumentPaymentRow);
    await updateDoc(doc(firestore, "companies", companyId, "documents", row.id), {
      paymentStatus: "paid",
      paidAmount: gross > 0 ? gross : null,
      paidAt: todayIso,
      paymentMethod: null,
      paymentNote: null,
      paid: true,
      paidBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    try {
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: row.id,
        before: { ...row, id: row.id },
        after: {
          ...row,
          id: row.id,
          paymentStatus: "paid",
          paidAmount: gross > 0 ? gross : null,
          paidAt: todayIso,
          paid: true,
        },
      });
    } catch (e) {
      console.error("documents: job income reconcile after paid", e);
    }
    toast({ title: "Označeno jako zaplaceno" });
  };

  const markDocumentUnpaid = async (row: CompanyDocumentRow) => {
    if (!companyId || !firestore || !user) return;
    await updateDoc(doc(firestore, "companies", companyId, "documents", row.id), {
      paymentStatus: "unpaid",
      paidAmount: deleteField(),
      paid: false,
      paidAt: deleteField(),
      paymentMethod: deleteField(),
      paymentNote: deleteField(),
      paidBy: deleteField(),
      updatedAt: serverTimestamp(),
    });
    try {
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: row.id,
        before: { ...row, id: row.id },
        after: {
          ...row,
          id: row.id,
          paymentStatus: "unpaid",
          paidAmount: null,
          paidAt: null,
          paid: false,
        },
      });
    } catch (e) {
      console.error("documents: job income reconcile after unpaid", e);
    }
    toast({ title: "Platba zrušena" });
  };

  const uploadDocumentFile = async (file: File): Promise<{
    fileUrl: string;
    fileName: string;
    fileType: string;
    mimeType: string;
    storagePath: string;
  }> => {
    if (!companyId || !user) throw new Error("Chybí firma nebo uživatel.");
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
    const safeExt = ext ? `.${String(ext).toLowerCase()}` : "";
    const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    const path = `companies/${companyId}/documents/uploads/${user.uid}/${key}`;
    const ref = storageRef(getFirebaseStorage(), path);
    await uploadBytes(ref, file, {
      contentType: file.type || "application/octet-stream",
    });
    const fileUrl = await getDownloadURL(ref);
    const top = (file.type || "").split("/")[0] || "application";
    return {
      fileUrl,
      fileName: file.name || key,
      fileType: top,
      mimeType: file.type || "application/octet-stream",
      storagePath: path,
    };
  };

  const syncDeliveryNoteInvoiceLink = async (params: {
    documentId: string;
    prevInvoiceId?: string | null;
    nextInvoiceId?: string | null;
  }) => {
    if (!firestore || !companyId) return;
    const prev = String(params.prevInvoiceId ?? "").trim();
    const next = String(params.nextInvoiceId ?? "").trim();
    if (prev && prev !== next) {
      await updateDoc(doc(firestore, "companies", companyId, "invoices", prev), {
        deliveryNoteIds: arrayRemove(params.documentId),
        updatedAt: serverTimestamp(),
      });
    }
    if (next) {
      await updateDoc(doc(firestore, "companies", companyId, "invoices", next), {
        deliveryNoteIds: arrayUnion(params.documentId),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleAddDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !firestore || !user) return;
    setIsSubmitting(true);

    try {
      const amountStr = formData.amount.trim();
      const amountParsed =
        amountStr === "" ? NaN : Number(String(amountStr).replace(",", "."));
      const docCurrency = formData.currency === "EUR" ? "EUR" : "CZK";
      const amountNetRaw =
        Number.isFinite(amountParsed) && amountParsed >= 0
          ? roundMoney2(amountParsed)
          : 0;
      const hasFinancialAmount =
        amountStr !== "" &&
        Number.isFinite(amountParsed) &&
        amountNetRaw > 0;

      if (newDocKind === "delivery_note") {
        if (!formData.number.trim()) {
          toast({ variant: "destructive", title: "Vyplňte číslo dokladu" });
          return;
        }
        if (!formData.entityName.trim()) {
          toast({ variant: "destructive", title: "Vyplňte dodavatele" });
          return;
        }
        const uploadMeta = newDocFile ? await uploadDocumentFile(newDocFile) : null;
        const selectedJob = jobs.find((j) => j.id === selectedJobId);
        const assignmentFinal: AssignmentType =
          assignmentType === "job_cost" ||
          assignmentType === "warehouse" ||
          assignmentType === "company" ||
          assignmentType === "pending_assignment"
            ? assignmentType
            : "pending_assignment";
        const invoiceId = selectedInvoiceId.trim() || null;
        const newDocRef = await addDoc(
          collection(firestore, "companies", companyId, "documents"),
          {
            documentType: "delivery_note",
            type: "delivery_note",
            documentKind: "delivery_note",
            number: formData.number.trim(),
            documentNumber: formData.number.trim(),
            entityName: formData.entityName.trim(),
            supplier: formData.entityName.trim(),
            date: formData.date?.trim() || null,
            note: formData.description.trim() || null,
            description: formData.description.trim() || null,
            assignmentType: assignmentFinal,
            jobId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
            zakazkaId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
            jobName: assignmentFinal === "job_cost" ? selectedJob?.name ?? null : null,
            assignedTo: {
              jobId: assignmentFinal === "job_cost" ? selectedJobId || null : null,
              companyId: assignmentFinal === "company" ? companyId : null,
              warehouseId:
                assignmentFinal === "warehouse" ? selectedWarehouseId || "main" : null,
            },
            invoiceId,
            fileUrl: uploadMeta?.fileUrl ?? null,
            fileName: uploadMeta?.fileName ?? null,
            fileType: uploadMeta?.fileType ?? null,
            mimeType: uploadMeta?.mimeType ?? null,
            storagePath: uploadMeta?.storagePath ?? null,
            organizationId: companyId,
            createdBy: user.uid,
            uploadedBy: user.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            isDeleted: false,
          }
        );
        if (invoiceId) {
          await syncDeliveryNoteInvoiceLink({
            documentId: newDocRef.id,
            nextInvoiceId: invoiceId,
          });
        }
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "newDocument",
          entityId: newDocRef.id,
          title: `Nový doklad: ${formData.number.trim()}`,
          lines: [
            `Dodavatel: ${formData.entityName.trim()}`,
            assignmentFinal === "pending_assignment" ? "Zařazení: čeká na přiřazení" : "",
          ].filter(Boolean),
          actionPath: `/portal/documents`,
        });
        if (assignmentFinal === "pending_assignment") {
          void sendModuleEmailNotificationFromBrowser({
            companyId: companyId!,
            module: "documents",
            eventKey: "pendingAssignment",
            entityId: newDocRef.id,
            title: `Doklad k zařazení: ${formData.number.trim()}`,
            lines: [formData.entityName.trim()],
            actionPath: `/portal/documents`,
          });
        }
        toast({ title: "Dodací list uložen" });
        setIsAddDocOpen(false);
        setNewDocKind("document");
        setFormData({
          number: "",
          entityName: "",
          amount: "",
          currency: "CZK",
          vat: "21",
          date: new Date().toISOString().split("T")[0],
          description: "",
          requiresPayment: false,
          dueDate: "",
          paymentStatus: "unpaid",
          paidAmount: "",
          paidAt: "",
          paymentMethod: "bank",
          paymentNote: "",
        });
        setNewDocFile(null);
        setAssignmentType("pending_assignment");
        setSelectedJobId("");
        setSelectedInvoiceId("");
        setSelectedWarehouseId("");
        return;
      }

      if (!hasFinancialAmount) {
        if (!newDocFile) {
          toast({
            variant: "destructive",
            title: "Chybí částka",
            description:
              "Doklad musí obsahovat částku. Jinak nahrajte soubor a vyberte zakázku (zařazení „Zakázka → náklad“) — uloží se pouze jako fotodokumentace u zakázky, ne v dokladech.",
          });
          return;
        }
        if (assignmentType !== "job_cost" || !selectedJobId) {
          toast({
            variant: "destructive",
            title: "Pro fotodokumentaci vyberte zakázku",
            description:
              "Doklad musí obsahovat částku. Bez částky lze soubor uložit jen jako fotodokumentaci — nastavte zařazení na „Zakázka → náklad“ a vyberte zakázku.",
          });
          return;
        }
        if (!isAllowedJobMediaFile(newDocFile)) {
          toast({
            variant: "destructive",
            title: "Nepodporovaný soubor",
            description: "Použijte JPG, PNG, WEBP nebo PDF.",
          });
          return;
        }
        if (newDocFile.size > MAX_JOB_PHOTO_BYTES) {
          toast({
            variant: "destructive",
            title: "Soubor je příliš velký",
            description: `Maximální velikost je ${Math.round(MAX_JOB_PHOTO_BYTES / (1024 * 1024))} MB.`,
          });
          return;
        }

        const { resolvedFullPath, downloadURL } =
          await uploadJobPhotoFileViaFirebaseSdk(
            newDocFile,
            companyId,
            selectedJobId
          );
        const photosColRef = collection(
          firestore,
          "companies",
          companyId,
          "jobs",
          selectedJobId,
          "photos"
        );
        const photoDocRef = doc(photosColRef);
        const safeBaseName =
          newDocFile.name
            .replace(/^.*[\\/]/, "")
            .replace(/\s+/g, " ")
            .trim() || "photo";
        const fileType = getJobMediaFileTypeFromFile(newDocFile);
        const selectedJob = jobs.find((j) => j.id === selectedJobId);
        const note = formData.description.trim() || null;

        await setDoc(photoDocRef, {
          id: photoDocRef.id,
          companyId,
          jobId: selectedJobId,
          imageUrl: downloadURL,
          url: downloadURL,
          originalImageUrl: downloadURL,
          downloadURL,
          fileType,
          storagePath: resolvedFullPath,
          path: resolvedFullPath,
          fileName: safeBaseName,
          name: safeBaseName,
          note,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
          uploadedBy: user.uid,
        });

        logActivitySafe(firestore, companyId, user, profile, {
          actionType: "job.photo_from_documents_page",
          actionLabel: "Fotodokumentace z formuláře dokladů (bez částky)",
          entityType: "job_photo",
          entityId: photoDocRef.id,
          entityName: safeBaseName,
          sourceModule: "documents",
          route: "/portal/documents",
          metadata: {
            jobId: selectedJobId,
            hadNote: Boolean(note),
          },
        });

        toast({
          title: "Fotodokumentace uložena",
          description: `Soubor byl přidán k zakázce „${selectedJob?.name ?? selectedJobId}“. V seznamu dokladů se nezobrazí (bez částky).`,
        });
        setIsAddDocOpen(false);
      setFormData({
        number: "",
        entityName: "",
        amount: "",
        currency: "CZK",
        vat: "21",
        date: new Date().toISOString().split("T")[0],
        description: "",
        requiresPayment: false,
        dueDate: "",
        paymentStatus: "unpaid",
        paidAmount: "",
        paidAt: "",
        paymentMethod: "bank",
        paymentNote: "",
      });
        setNewDocFile(null);
        setAssignmentType("pending_assignment");
        setSelectedJobId("");
        setSelectedInvoiceId("");
        setSelectedWarehouseId("");
        return;
      }

      const vatRate = normalizeVatRate(Number(formData.vat));
      let amountNet: number;
      let vatAmount: number;
      let amountGross: number;
      if (docCurrency === "EUR") {
        amountNet = amountNetRaw;
        vatAmount = roundMoney2((amountNet * vatRate) / 100);
        amountGross = roundMoney2(amountNet + vatAmount);
      } else {
        const netInt = Math.round(amountNetRaw);
        const c = calculateVatAmountsFromNet(netInt, vatRate);
        amountNet = netInt;
        vatAmount = c.vatAmount;
        amountGross = c.amountGross;
      }

      const paymentStatus = formData.paymentStatus;
      const paidAtInput = String(formData.paidAt ?? "").trim();
      const paymentMethodInput = String(formData.paymentMethod ?? "").trim();
      const paymentNoteInput = String(formData.paymentNote ?? "").trim();
      const paidAmountInput = String(formData.paidAmount ?? "").trim();

      let paidAmount: number | null = null;
      let paidAt: string | null = null;
      let paymentMethod: string | null = null;
      let paymentNote: string | null = null;
      const totalGross = amountGross;

      if (paymentStatus === "paid") {
        paidAmount = totalGross;
        paidAt = paidAtInput || todayIso;
        paymentMethod = paymentMethodInput || null;
        paymentNote = paymentNoteInput || null;
      } else if (paymentStatus === "partial") {
        const pa =
          paidAmountInput === ""
            ? NaN
            : Number(String(paidAmountInput).replace(",", "."));
        if (!Number.isFinite(pa)) {
          toast({
            variant: "destructive",
            title: "Neplatná uhrazená částka",
            description: "Zadejte uhrazenou částku jako číslo.",
          });
          return;
        }
        const pa2 = roundMoney2(pa);
        if (pa2 <= 0) {
          toast({
            variant: "destructive",
            title: "Neplatná uhrazená částka",
            description: "U částečné úhrady zadejte částku větší než 0.",
          });
          return;
        }
        if (pa2 > totalGross) {
          toast({
            variant: "destructive",
            title: "Příliš vysoká úhrada",
            description:
              "Uhrazená částka nesmí překročit celkovou částku dokladu (s DPH).",
          });
          return;
        }
        if (pa2 >= totalGross) {
          toast({
            variant: "destructive",
            title: "Plná částka",
            description: 'Pro celou výši dokladu zvolte stav „Uhrazeno“.',
          });
          return;
        }
        paidAmount = pa2;
        paidAt = paidAtInput || todayIso;
        paymentMethod = paymentMethodInput || null;
        paymentNote = paymentNoteInput || null;
      } else {
        paidAmount = null;
        paidAt = null;
        paymentMethod = null;
        paymentNote = null;
      }

      let rateEurCzk = 1;
      let rateUsedFallback = false;
      if (docCurrency === "EUR") {
        const r = await resolveEurCzkRate();
        rateEurCzk = r.rate;
        rateUsedFallback = r.usedFallback;
      }
      const czk = amountsToCzk(docCurrency, rateEurCzk, {
        amountNet,
        vatAmount,
        amountGross,
      });
      const amountOriginal = grossOriginal({
        amountNet,
        vatAmount,
        amountGross,
      });

      if (!formData.number.trim()) {
        toast({
          variant: "destructive",
          title: "Vyplňte číslo dokladu",
        });
        return;
      }
      if (!formData.entityName.trim()) {
        toast({
          variant: "destructive",
          title: "Vyplňte subjekt",
        });
        return;
      }

      if (assignmentType === "job_cost" && !selectedJobId) {
        throw new Error("Vyberte zakázku, ke které doklad patří.");
      }
      if (formData.requiresPayment && !formData.dueDate.trim()) {
        toast({
          title: "Upozornění: chybí splatnost",
          description:
            "Doklad je označený k úhradě, ale nemáte vyplněné datum splatnosti. Doplňte ho v přehledu úhrad nebo upravte doklad.",
        });
      }
      const selectedJob = jobs.find((j) => j.id === selectedJobId);
      const uploadMeta = newDocFile ? await uploadDocumentFile(newDocFile) : null;
      const colRef = collection(firestore, "companies", companyId, "documents");
      const profileName =
        String((profile as { displayName?: string; email?: string })?.displayName ?? "").trim() ||
        String((profile as { email?: string })?.email ?? user?.email ?? "").trim() ||
        "Uživatel";
      const newDocRef = await addDoc(colRef, {
        number: formData.number.trim(),
        entityName: formData.entityName.trim(),
        description: formData.description.trim(),
        date: formData.date,
        type: newDocType,
        documentKind: newDocType === "received" ? "prijate" : "vydane",
        currency: docCurrency,
        amountOriginal,
        amountCZK: czk.castkaCZK,
        exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
        amount: amountNet,
        amountNet,
        castka: amountGross,
        castkaCZK: czk.castkaCZK,
        amountNetCZK: czk.amountNetCZK,
        amountGrossCZK: czk.amountGrossCZK,
        vatAmountCZK: czk.vatAmountCZK,
        sDPH: true,
        vatRate,
        dphSazba: vatRate,
        vatAmount,
        amountGross,
        vat: vatRate,
        organizationId: companyId,
        createdBy: user?.uid,
        uploadedBy: user?.uid,
        uploadedByName: profileName,
        assignmentType,
        jobId: assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
        zakazkaId:
          assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
        jobName: assignmentType === "job_cost" ? selectedJob?.name ?? null : null,
        fileUrl: uploadMeta?.fileUrl ?? null,
        fileName: uploadMeta?.fileName ?? null,
        fileType: uploadMeta?.fileType ?? null,
        mimeType: uploadMeta?.mimeType ?? null,
        storagePath: uploadMeta?.storagePath ?? null,
        createdAt: serverTimestamp(),
        requiresPayment: formData.requiresPayment,
        dueDate: formData.dueDate.trim() || null,
        paymentStatus,
        paidAmount,
        paidAt,
        paymentMethod,
        paymentNote,
        paid: paymentStatus === "paid",
        ...(paymentStatus === "paid" || paymentStatus === "partial"
          ? { paidBy: user.uid }
          : {}),
        isDeleted: false,
      });

      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.create",
        actionLabel:
          newDocType === "received" ? "Nový přijatý doklad" : "Nový vydaný doklad",
        entityType: "company_document",
        entityId: newDocRef.id,
        entityName: formData.number?.trim() || newDocRef.id,
        details: `${formData.entityName?.trim() || "—"} · ${amountNet} ${docCurrency === "EUR" ? "EUR" : "Kč"} bez DPH / ${amountGross} ${docCurrency === "EUR" ? "EUR" : "Kč"} s DPH (≈ ${czk.castkaCZK} Kč)`,
        sourceModule: "documents",
        route: "/portal/documents",
        metadata: {
          docType: newDocType,
          number: formData.number,
          amountNet,
          amountGross,
          vatRate,
          date: formData.date,
          assignmentType,
          jobId: assignmentType === "job_cost" ? selectedJob?.id ?? selectedJobId : null,
        },
      });

      /**
       * Náklady zakázky musí vzniknout vždy, i když zápis do `finance` selže (jiná pravidla / chybějící kolekce).
       * Dříve při výjimce z `addDoc(finance)` vůbec neproběhl reconcile → doklad bez nákladu v zakázce.
       */
      const jobIdForCost =
        assignmentType === "job_cost"
          ? selectedJob?.id ?? selectedJobId
          : null;
      const afterReconcile = {
        assignmentType,
        jobId: jobIdForCost,
        zakazkaId: jobIdForCost,
        number: formData.number.trim(),
        entityName: formData.entityName.trim(),
        nazev: formData.entityName.trim(),
        description: formData.description.trim(),
        date: formData.date,
        currency: docCurrency,
        amountOriginal,
        amountCZK: czk.castkaCZK,
        exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
        castka: amountGross,
        castkaCZK: czk.castkaCZK,
        amountNetCZK: czk.amountNetCZK,
        amountGrossCZK: czk.amountGrossCZK,
        vatAmountCZK: czk.vatAmountCZK,
        amountNet,
        amount: amountNet,
        amountGross,
        vatAmount,
        vatRate,
        dphSazba: vatRate,
        vat: vatRate,
        sDPH: true,
        type: newDocType,
        documentKind: newDocType === "received" ? "prijate" : "vydane",
        source: undefined,
        sourceType: undefined,
        fileUrl: uploadMeta?.fileUrl ?? null,
        fileName: uploadMeta?.fileName ?? null,
        fileType: uploadMeta?.fileType ?? null,
        mimeType: uploadMeta?.mimeType ?? null,
        storagePath: uploadMeta?.storagePath ?? null,
        requiresPayment: formData.requiresPayment,
        paymentStatus,
        paidAmount,
        paidAt,
        paymentMethod,
        paymentNote,
        paid: paymentStatus === "paid",
      } as CompanyDocumentExpenseReconcileBefore;
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: newDocRef.id,
        before: null,
        after: afterReconcile,
      });
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: newDocRef.id,
        before: null,
        after: afterReconcile,
      });

      const financeRef = collection(firestore, "companies", companyId, "finance");
      try {
        await addDoc(financeRef, {
          amount: czk.castkaCZK,
          amountNet: czk.amountNetCZK,
          amountGross: czk.amountGrossCZK,
          vatRate,
          type: newDocType === "received" ? "expense" : "revenue",
          date: formData.date,
          description: `Doklad ${formData.number}: ${formData.description}`,
          createdAt: serverTimestamp(),
        });
      } catch (financeErr) {
        console.error("documents: finance ledger write failed", financeErr);
      }

      void sendModuleEmailNotificationFromBrowser({
        companyId: companyId!,
        module: "documents",
        eventKey: "newDocument",
        entityId: newDocRef.id,
        title: `Nový doklad: ${formData.number.trim()}`,
        lines: [
          newDocType === "received" ? "Přijatý doklad" : "Vydaný doklad",
          `Subjekt: ${formData.entityName.trim()}`,
          assignmentType === "pending_assignment" ? "Zařazení: čeká na přiřazení" : "",
        ].filter(Boolean),
        actionPath: `/portal/documents`,
      });
      if (assignmentType === "pending_assignment") {
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "pendingAssignment",
          entityId: newDocRef.id,
          title: `Doklad k zařazení: ${formData.number.trim()}`,
          lines: [formData.entityName.trim()],
          actionPath: `/portal/documents`,
        });
      }

      toast({
        title: "Doklad uložen",
        description:
          docCurrency === "EUR" && rateUsedFallback
            ? `Záznam ${formData.number} byl přidán. Kurz EUR použit z poslední známé hodnoty nebo výchozího přepočtu (API nedostupné).`
            : `Záznam ${formData.number} byl úspěšně přidán.`,
        variant: docCurrency === "EUR" && rateUsedFallback ? "default" : undefined,
      });
      setIsAddDocOpen(false);
      setFormData({
        number: "",
        entityName: "",
        amount: "",
        currency: "CZK",
        vat: "21",
        date: new Date().toISOString().split("T")[0],
        description: "",
        requiresPayment: false,
        dueDate: "",
        paymentStatus: "unpaid",
        paidAmount: "",
        paidAt: "",
        paymentMethod: "bank",
        paymentNote: "",
      });
      setNewDocFile(null);
      setAssignmentType("pending_assignment");
      setSelectedJobId("");
      setSelectedInvoiceId("");
      setSelectedWarehouseId("");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Nepodařilo se uložit doklad.";
      toast({
        variant: "destructive",
        title: "Chyba",
        description: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAssignDialog = (row: CompanyDocumentRow) => {
    setAssigningDocId(row.id);
    setAssignTypeNext(effectiveCompanyDocumentAssignmentTypeForForm(row));
    setAssignJobIdNext(documentJobLinkId(row));
    setAssignDialogOpen(true);
  };

  const saveAssignment = async () => {
    if (!companyId || !assigningDocId || !firestore || !user) return;
    if (assignTypeNext === "job_cost" && !assignJobIdNext) {
      toast({
        variant: "destructive",
        title: "Vyberte zakázku",
        description: "Pro zařazení do nákladů zakázky je nutné vybrat zakázku.",
      });
      return;
    }
    const selected = jobs.find((j) => j.id === assignJobIdNext);
    const jid =
      assignTypeNext === "job_cost" ? selected?.id ?? assignJobIdNext : null;
    const docRef = doc(
      firestore,
      "companies",
      companyId,
      "documents",
      assigningDocId
    );
    try {
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        toast({
          variant: "destructive",
          title: "Doklad nenalezen",
          description: "Obnovte stránku a zkuste to znovu.",
        });
        return;
      }
      const beforeRow = snap.data() as CompanyDocumentRow;
      const isDl = isDeliveryNote(beforeRow);
      const before: CompanyDocumentExpenseReconcileBefore = {
        ...beforeRow,
        id: assigningDocId,
      };
      await updateDoc(docRef, {
        assignmentType: assignTypeNext,
        jobId: jid,
        zakazkaId: jid,
        jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
        assignedTo: {
          jobId: assignTypeNext === "job_cost" ? jid : null,
          companyId: assignTypeNext === "company" ? companyId : null,
          warehouseId: assignTypeNext === "warehouse" ? "main" : null,
        },
        jobCostAllocations: deleteField(),
        jobCostAllocationMode: deleteField(),
        allocations: deleteField(),
        allocationMode: deleteField(),
        allocationJobIds: deleteField(),
        updatedAt: serverTimestamp(),
      });
      if (
        documentShowsAsPendingAssignment(beforeRow) &&
        assignTypeNext !== "pending_assignment"
      ) {
        const docTitle =
          beforeRow.number?.trim() ||
          beforeRow.entityName?.trim() ||
          assigningDocId;
        let placementLine = "";
        if (assignTypeNext === "job_cost") {
          placementLine = `Zařazeno do nákladů zakázky: ${selected?.name?.trim() || jid || "—"}`;
        } else if (assignTypeNext === "warehouse") {
          placementLine = "Zařazeno ke skladu";
        } else if (assignTypeNext === "company" || assignTypeNext === "overhead") {
          placementLine = "Zařazeno jako režie firmy";
        }
        void sendModuleEmailNotificationFromBrowser({
          companyId: companyId!,
          module: "documents",
          eventKey: "updated",
          entityId: assigningDocId,
          title: `Doklad zařazen: ${docTitle}`,
          lines: [placementLine].filter(Boolean),
          actionPath: `/portal/documents`,
        });
      }
      if (isDl) {
        setAssignDialogOpen(false);
        setAssigningDocId(null);
        toast({ title: "Zařazení uloženo" });
        return;
      }
      const after: CompanyDocumentExpenseReconcileBefore = {
        ...before,
        assignmentType: assignTypeNext,
        jobId: jid,
        zakazkaId: jid,
        jobName: assignTypeNext === "job_cost" ? selected?.name ?? null : null,
      };
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: assigningDocId,
        before,
        after,
      });
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: assigningDocId,
        before,
        after,
      });
      setAssignDialogOpen(false);
      setAssigningDocId(null);
      toast({ title: "Zařazení uloženo" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Zařazení se nepovedlo",
        description:
          e instanceof Error
            ? e.message
            : "Zkontrolujte oprávnění a data dokladu (částka, typ přijatého dokladu).",
      });
    }
  };

  const openEditDocument = (row: CompanyDocumentRow) => {
    setEditSplitToJobs(false);
    setEditAllocMode("amount");
    setEditAllocRows([]);
    if (isDeliveryNote(row)) {
      setEditInvoiceId(String(row.invoiceId ?? "").trim());
      {
        let at = effectiveCompanyDocumentAssignmentTypeForForm(row);
        if (at === "overhead") at = "company";
        setEditAssignmentType(
          at === "job_cost" ||
            at === "company" ||
            at === "warehouse" ||
            at === "pending_assignment"
            ? at
            : "pending_assignment"
        );
      }
      setEditWarehouseId(String(row.assignedTo?.warehouseId ?? "").trim());
      setEditSupplier(String((row as { supplier?: string }).supplier ?? row.entityName ?? ""));
      setEditRow(row);
      setEditForm({
        nazev: row.number?.trim() || docDisplayTitle(row),
        castka: "",
        currency: "CZK",
        sDPH: false,
        dphSazba: "0",
        date: row.date ?? "",
        poznamka: String(row.note ?? row.description ?? ""),
        zakazkaId: row.zakazkaId ?? row.jobId ?? "",
        noJobMode:
          row.assignmentType === "warehouse"
            ? "overhead"
            : row.assignmentType === "company"
              ? "overhead"
              : "pending",
        requiresPayment: false,
        dueDate: "",
      });
      setEditOpen(true);
      return;
    }
    const sDPH = inferSDPH(row);
    const am = docDisplayAmounts(row);
    const baseAmount = sDPH ? am.amountNet : am.amountGross;
    const rate = String(
      row.dphSazba ?? row.vatRate ?? row.vat ?? 21
    );
    setEditRow(row);
    setEditInvoiceId(String(row.invoiceId ?? "").trim());
    setEditAssignmentType(effectiveCompanyDocumentAssignmentTypeForForm(row));
    setEditWarehouseId(String(row.assignedTo?.warehouseId ?? "").trim());
    setEditSupplier(String((row as { supplier?: string }).supplier ?? row.entityName ?? ""));
    setEditForm({
      nazev: docDisplayTitle(row),
      castka: baseAmount > 0 ? String(baseAmount) : "",
      currency: row.currency === "EUR" ? "EUR" : "CZK",
      sDPH,
      dphSazba: rate,
      date: row.date ?? new Date().toISOString().split("T")[0],
      poznamka: String(row.poznamka ?? row.note ?? row.description ?? ""),
      zakazkaId: row.zakazkaId ?? row.jobId ?? "",
      noJobMode: row.assignmentType === "overhead" ? "overhead" : "pending",
      requiresPayment: row.requiresPayment === true,
      dueDate: row.dueDate?.trim() ?? "",
    });
    const resolved = resolveJobCostAllocationsFromDocument(row);
    if (
      isReceivedDoc(row) &&
      resolved.usesExplicitAllocations &&
      resolved.rows.length > 0
    ) {
      setEditSplitToJobs(true);
      setEditAllocMode(resolved.mode);
      setEditAllocRows(
        resolved.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          jobId: r.jobId?.trim() ?? "",
          amount:
            r.amount != null && Number.isFinite(r.amount)
              ? String(r.amount)
              : "",
          percent:
            r.percent != null && Number.isFinite(r.percent)
              ? String(r.percent)
              : "",
          note: r.note?.trim() ?? "",
          linkedExpenseId: r.linkedExpenseId ?? null,
        }))
      );
    }
    setEditOpen(true);
  };

  const saveEditDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !editRow || !firestore || !user) return;
    if (!editForm.nazev.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí název",
        description: "Vyplňte název dokladu.",
      });
      return;
    }
    if (isDeliveryNote(editRow)) {
      setIsEditSaving(true);
      try {
        const selectedJob = jobs.find((j) => j.id === editForm.zakazkaId.trim());
        const assign =
          editAssignmentType === "job_cost" ||
          editAssignmentType === "warehouse" ||
          editAssignmentType === "company" ||
          editAssignmentType === "pending_assignment"
            ? editAssignmentType
            : "pending_assignment";
        const payload: Record<string, unknown> = {
          number: editForm.nazev.trim(),
          documentNumber: editForm.nazev.trim(),
          supplier: editSupplier.trim() || null,
          entityName: editSupplier.trim() || null,
          date: editForm.date?.trim() || null,
          note: editForm.poznamka.trim() || null,
          description: editForm.poznamka.trim() || null,
          assignmentType: assign,
          jobId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
          zakazkaId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
          jobName: assign === "job_cost" ? selectedJob?.name ?? null : null,
          assignedTo: {
            jobId: assign === "job_cost" ? editForm.zakazkaId.trim() || null : null,
            companyId: assign === "company" ? companyId : null,
            warehouseId: assign === "warehouse" ? editWarehouseId.trim() || "main" : null,
          },
          invoiceId: editInvoiceId.trim() || null,
          updatedAt: serverTimestamp(),
        };
        await updateDoc(
          doc(firestore, "companies", companyId, "documents", editRow.id),
          payload as unknown as UpdateData<DocumentData>
        );
        await syncDeliveryNoteInvoiceLink({
          documentId: editRow.id,
          prevInvoiceId: editRow.invoiceId ?? null,
          nextInvoiceId: editInvoiceId.trim() || null,
        });
        toast({ title: "Dodací list uložen" });
        setEditOpen(false);
        setEditRow(null);
      } catch {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Nepodařilo se uložit změny dodacího listu.",
        });
      } finally {
        setIsEditSaving(false);
      }
      return;
    }
    const castkaNum = Number(String(editForm.castka).replace(",", "."));
    if (!Number.isFinite(castkaNum) || castkaNum <= 0) {
      toast({
        variant: "destructive",
        title: "Neplatná částka",
        description: "Zadejte částku větší než 0.",
      });
      return;
    }
    const dphPct = parseVatPercentInput(editForm.dphSazba);
    const docCurrency = editForm.currency === "EUR" ? "EUR" : "CZK";
    setIsEditSaving(true);
    try {
      const nazev = editForm.nazev.trim();
      const poznamka = editForm.poznamka.trim();
      const zid = editForm.zakazkaId.trim();
      const selectedJob = jobs.find((j) => j.id === zid);

      let rateEurCzk = 1;
      let rateUsedFallback = false;
      if (docCurrency === "EUR") {
        const stored = Number(editRow.exchangeRate ?? 0);
        if (Number.isFinite(stored) && stored > 0) {
          rateEurCzk = stored;
        } else {
          const r = await resolveEurCzkRate();
          rateEurCzk = r.rate;
          rateUsedFallback = r.usedFallback;
        }
      }

      const basePayload: Record<string, unknown> = {
        nazev,
        entityName: nazev,
        date: editForm.date,
        poznamka: poznamka || null,
        note: poznamka || null,
        description: poznamka || null,
        currency: docCurrency,
        updatedAt: serverTimestamp(),
      };

      if (editForm.sDPH) {
        const net = roundMoney2(castkaNum);
        const vatAmount = roundMoney2((net * dphPct) / 100);
        const gross = roundMoney2(net + vatAmount);
        const czk = amountsToCzk(docCurrency, rateEurCzk, {
          amountNet: net,
          vatAmount,
          amountGross: gross,
        });
        const amountOriginal = grossOriginal({
          amountNet: net,
          vatAmount,
          amountGross: gross,
        });
        Object.assign(basePayload, {
          sDPH: true,
          dphSazba: dphPct,
          castka: gross,
          amountNet: net,
          vatAmount,
          amountGross: gross,
          amount: net,
          vatRate: dphPct,
          vat: dphPct,
          amountOriginal,
          amountCZK: czk.castkaCZK,
          exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
          castkaCZK: czk.castkaCZK,
          amountNetCZK: czk.amountNetCZK,
          amountGrossCZK: czk.amountGrossCZK,
          vatAmountCZK: czk.vatAmountCZK,
        });
      } else {
        const c = roundMoney2(castkaNum);
        const czk = amountsToCzk(docCurrency, rateEurCzk, {
          amountNet: c,
          vatAmount: 0,
          amountGross: c,
        });
        const amountOriginal = grossOriginal({
          amountNet: c,
          vatAmount: 0,
          amountGross: c,
        });
        Object.assign(basePayload, {
          sDPH: false,
          dphSazba: null,
          castka: c,
          amountNet: c,
          amountGross: c,
          vatAmount: 0,
          vatRate: 0,
          vat: 0,
          amount: c,
          amountOriginal,
          amountCZK: czk.castkaCZK,
          exchangeRate: docCurrency === "EUR" ? rateEurCzk : 1,
          castkaCZK: czk.castkaCZK,
          amountNetCZK: czk.amountNetCZK,
          amountGrossCZK: czk.amountGrossCZK,
          vatAmountCZK: czk.vatAmountCZK,
        });
      }

      const applyJobCostSplit =
        editSplitToJobs && editRow && isReceivedDoc(editRow);
      if (applyJobCostSplit) {
        const dupCheck = new Map<string, number>();
        for (const ar of editAllocRows) {
          if (ar.kind !== "job") continue;
          const j = ar.jobId.trim();
          if (!j) continue;
          dupCheck.set(j, (dupCheck.get(j) ?? 0) + 1);
        }
        if ([...dupCheck.values()].some((n) => n > 1)) {
          toast({
            variant: "destructive",
            title: "Duplicitní zakázka",
            description:
              "Ve rozdělení je stejná zakázka vícekrát. Sloučte řádky nebo zvolte jiné zakázky.",
          });
          setIsEditSaving(false);
          return;
        }
        const mergedForBasis = {
          ...editRow,
          ...basePayload,
        } as CompanyDocumentRow;
        const basis = allocationBasisGrossCzk(
          mergedForBasis as Parameters<typeof allocationBasisGrossCzk>[0]
        );
        const domainRows = editAllocFormRowsToDomain(editAllocRows);
        const val = validateJobCostAllocations({
          mode: editAllocMode,
          rows: domainRows,
          basisGrossCzk: basis,
        });
        if (!val.ok) {
          toast({
            variant: "destructive",
            title: "Rozdělení na zakázky",
            description: val.message,
          });
          setIsEditSaving(false);
          return;
        }
        const hasJob = domainRows.some(
          (r) => r.kind === "job" && r.jobId?.trim()
        );
        if (hasJob) {
          const first = domainRows.find(
            (r) => r.kind === "job" && r.jobId?.trim()
          )!;
          const jid = first.jobId!.trim();
          const sel = jobs.find((j) => j.id === jid);
          basePayload.zakazkaId = jid;
          basePayload.jobId = jid;
          basePayload.jobName = sel?.name ?? null;
          basePayload.assignmentType = "job_cost";
        } else {
          basePayload.zakazkaId = null;
          basePayload.jobId = null;
          basePayload.jobName = null;
          basePayload.assignmentType = "overhead";
        }
        basePayload.jobCostAllocations = domainRows.map((r) => ({
          id: r.id,
          kind: r.kind,
          jobId: r.jobId,
          amount: r.amount ?? null,
          percent: r.percent ?? null,
          note: r.note ?? null,
          linkedExpenseId: r.linkedExpenseId ?? null,
        }));
        basePayload.jobCostAllocationMode = editAllocMode;
        basePayload.allocationMode = editAllocMode;
        basePayload.allocations = allocationsMirrorForDocument(domainRows);
        basePayload.allocationJobIds =
          allocationJobIdsFromRows(domainRows);
        basePayload.assignedTo = {
          jobId: hasJob ? String(basePayload.jobId ?? "") : null,
          companyId: null,
          warehouseId: null,
        };
      } else {
        basePayload.jobCostAllocations = deleteField();
        basePayload.jobCostAllocationMode = deleteField();
        basePayload.allocations = deleteField();
        basePayload.allocationMode = deleteField();
        basePayload.allocationJobIds = deleteField();
        if (zid) {
          basePayload.zakazkaId = zid;
          basePayload.jobId = zid;
          basePayload.jobName = selectedJob?.name ?? null;
          basePayload.assignmentType = "job_cost";
        } else {
          basePayload.zakazkaId = null;
          basePayload.jobId = null;
          basePayload.jobName = null;
          basePayload.assignmentType =
            editForm.noJobMode === "overhead"
              ? "overhead"
              : "pending_assignment";
        }
      }

      basePayload.requiresPayment = editForm.requiresPayment;
      basePayload.dueDate = editForm.dueDate.trim() || null;

      if (editForm.requiresPayment && !editForm.dueDate.trim()) {
        toast({
          title: "Upozornění: chybí splatnost",
          description:
            "Doklad je označený k úhradě bez data splatnosti. Doplňte splatnost pro správné řazení a připomínky.",
        });
      }

      const docRef = doc(
        firestore,
        "companies",
        companyId,
        "documents",
        editRow.id
      );
      await updateDoc(docRef, basePayload as unknown as UpdateData<DocumentData>);
      /** Po uložení vždy přečíst z DB — sloučení s `editRow` občas neodrazilo pole alokací / CZK správně a reconcile pak nesprávně vyhodnotil „bez zakázky“ a poškodil split. */
      const savedSnap = await getDoc(docRef);
      if (!savedSnap.exists()) {
        throw new Error("Doklad po uložení v databázi nenalezen.");
      }
      const afterForExpense = {
        ...(savedSnap.data() as CompanyDocumentRow),
        id: editRow.id,
      } as CompanyDocumentExpenseReconcileBefore;
      const beforeForExpense = {
        ...editRow,
        id: editRow.id,
      } as CompanyDocumentExpenseReconcileBefore;
      await reconcileCompanyDocumentJobExpense({
        firestore,
        companyId,
        userId: user.uid,
        documentId: editRow.id,
        before: beforeForExpense,
        after: afterForExpense,
      });
      await reconcileCompanyDocumentJobIncome({
        firestore,
        companyId,
        userId: user.uid,
        documentId: editRow.id,
        before: beforeForExpense,
        after: afterForExpense,
      });
      toast({
        title: "Doklad uložen",
        description:
          docCurrency === "EUR" && rateUsedFallback
            ? "Kurz EUR byl doplněn z poslední známé hodnoty nebo výchozího přepočtu (API nedostupné)."
            : undefined,
      });
      setEditOpen(false);
      setEditRow(null);
    } catch (err) {
      console.error("documents: saveEditDocument", err);
      toast({
        variant: "destructive",
        title: "Chyba",
        description:
          err instanceof Error
            ? err.message
            : "Nepodařilo se uložit změny dokladu.",
      });
    } finally {
      setIsEditSaving(false);
    }
  };

  const requestDeleteDocument = (row: CompanyDocumentRow) => {
    if (!canSoftDelete) {
      toast({
        variant: "destructive",
        title: "Nedostatečné oprávnění",
        description: "Smazat doklad může pouze administrátor organizace.",
      });
      return;
    }
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const requestDeleteInvoice = (inv: Record<string, unknown> & { id: string }) => {
    if (!canSoftDelete) {
      toast({
        variant: "destructive",
        title: "Nedostatečné oprávnění",
        description: "Smazat fakturu může pouze administrátor organizace.",
      });
      return;
    }
    const label =
      String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id).trim() || inv.id;
    setDeleteInvoiceTarget({ id: inv.id, label });
    setDeleteInvoiceOpen(true);
  };

  const performDeleteDocument = async () => {
    const row = deleteTarget;
    if (!row || !companyId || !firestore || !user?.uid) return;
    if (!canSoftDelete) return;

    setIsDeleting(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "documents", row.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
        } as unknown as UpdateData<DocumentData>
      );
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "document.soft_delete",
        actionLabel: "Skrytí dokladu (koš)",
        entityType: "company_document",
        entityId: row.id,
        entityName: row.number || row.entityName || row.id,
        sourceModule: "documents",
        route: "/portal/documents",
        metadata: { docType: row.type },
      });
      toast({ title: "Doklad byl smazán" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
      setDeleteTarget(null);
    }
  };

  const performDeleteInvoice = async () => {
    const t = deleteInvoiceTarget;
    if (!t || !companyId || !firestore || !user?.uid) return;
    if (!canSoftDelete) return;

    setIsDeletingInvoice(true);
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "invoices", t.id),
        {
          isDeleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: user.uid,
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        } as unknown as UpdateData<DocumentData>
      );
      logActivitySafe(firestore, companyId, user, profile, {
        actionType: "invoice.soft_delete",
        actionLabel: "Skrytí faktury (koš)",
        entityType: "invoice",
        entityId: t.id,
        entityName: t.label,
        sourceModule: "documents",
        route: "/portal/documents",
      });
      toast({ title: "Doklad byl smazán" });
    } catch {
      toast({ variant: "destructive", title: "Chyba při mazání faktury" });
    } finally {
      setIsDeletingInvoice(false);
      setDeleteInvoiceOpen(false);
      setDeleteInvoiceTarget(null);
    }
  };

  const receivedDocsBase = useMemo(() => {
    return financialDocuments.filter((d) => isReceivedDoc(d));
  }, [financialDocuments]);

  const issuedDocs = useMemo(() => {
    const base = financialDocuments.filter(
      (d) => d.type === "issued"
    );
    const q = issuedSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter((d) => {
      const hay = [d.number, d.entityName, d.nazev, d.description, d.note, d.poznamka]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [financialDocuments, issuedSearch]);

  const issuedInvoicesFiltered = useMemo(() => {
    const raw = invoicesForCurrentView as Array<
      Record<string, unknown> & { id: string }
    >;
    const q = issuedSearch.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter((inv) => {
      const hay = [
        inv.invoiceNumber,
        inv.customerName,
        inv.documentNumber,
        String(inv.jobId ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [invoicesForCurrentView, issuedSearch]);

  const editSplitRemainder = useMemo(() => {
    if (!editRow || !editSplitToJobs) {
      return { kind: "amount" as const, value: 0 };
    }
    const basis = previewEditDocumentGrossCzk(editRow, editForm);
    const d = editAllocFormRowsToDomain(editAllocRows);
    if (editAllocMode === "amount") {
      let sum = 0;
      for (const r of d) {
        sum += Number(r.amount ?? 0);
      }
      return { kind: "amount" as const, value: roundMoney2(basis - sum) };
    }
    let sumP = 0;
    for (const r of d) {
      sumP += Number(r.percent ?? 0);
    }
    return { kind: "percent" as const, value: roundMoney2(100 - sumP) };
  }, [editRow, editSplitToJobs, editForm, editAllocRows, editAllocMode]);

  const fillEditAllocRemainder = useCallback(() => {
    setEditAllocRows((rows) => {
      if (rows.length === 0 || !editRow) return rows;
      const basis = previewEditDocumentGrossCzk(editRow, editForm);
      const d = editAllocFormRowsToDomain(rows);
      if (editAllocMode === "amount") {
        let sum = 0;
        for (let i = 0; i < d.length - 1; i++) {
          sum += Number(d[i].amount ?? 0);
        }
        const rest = roundMoney2(Math.max(0, basis - sum));
        const last = { ...rows[rows.length - 1] };
        last.amount = String(rest);
        return [...rows.slice(0, -1), last];
      }
      let sumP = 0;
      for (let i = 0; i < d.length - 1; i++) {
        sumP += Number(d[i].percent ?? 0);
      }
      const restP = roundMoney2(Math.max(0, 100 - sumP));
      const last = { ...rows[rows.length - 1] };
      last.percent = String(restP);
      return [...rows.slice(0, -1), last];
    });
  }, [editRow, editForm, editAllocMode]);

  const editAllocDuplicateJobIds = useMemo(() => {
    if (!editSplitToJobs) return [] as string[];
    const counts = new Map<string, number>();
    for (const ar of editAllocRows) {
      if (ar.kind !== "job") continue;
      const j = ar.jobId.trim();
      if (!j) continue;
      counts.set(j, (counts.get(j) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id);
  }, [editSplitToJobs, editAllocRows]);

  const editAllocSavePreview = useMemo(() => {
    if (!editRow || !editSplitToJobs) return null;
    const basis = previewEditDocumentGrossCzk(editRow, editForm);
    const domain = editAllocFormRowsToDomain(editAllocRows);
    const val = validateJobCostAllocations({
      mode: editAllocMode,
      rows: domain,
      basisGrossCzk: basis,
    });
    let allocatedCzk = 0;
    let sumPct = 0;
    if (editAllocMode === "amount") {
      for (const r of domain) {
        allocatedCzk += roundMoney2(Number(r.amount ?? 0));
      }
    } else {
      for (const r of domain) {
        sumPct += Number(r.percent ?? 0);
      }
      const grossByRow = computeAllocationGrossCzkShares({
        mode: "percent",
        rows: domain,
        basisGrossCzk: basis,
      });
      for (const g of grossByRow.values()) {
        allocatedCzk += g;
      }
    }
    return {
      basis,
      val,
      allocatedCzk: roundMoney2(allocatedCzk),
      sumPct: roundMoney2(sumPct),
      remainderCzk: roundMoney2(basis - allocatedCzk),
    };
  }, [editRow, editSplitToJobs, editForm, editAllocRows, editAllocMode]);

  if (isProfileLoading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Nelze načíst doklady bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  const isEditingDeliveryNote = editRow ? isDeliveryNote(editRow) : false;

  return (
    <TooltipProvider delayDuration={250}>
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-4 space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 sm:text-3xl dark:text-gray-50">
            Firemní doklady
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-900 dark:text-gray-200 sm:text-[15px]">
            Přehled přijatých i vydaných dokladů a vystavených faktur (jednotná evidence). Zálohové a
            vyúčtovací faktury ze zakázek jsou ve vydaných dokladech; fotodokumentace bez částky jen u
            zakázky v médiích.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlineLight" className="h-10 gap-2" asChild>
            <Link href="/portal/invoices/new">
              <ReceiptText className="h-4 w-4 shrink-0" /> Nová faktura
            </Link>
          </Button>
          <Dialog open={isAddDocOpen} onOpenChange={setIsAddDocOpen}>
            <DialogTrigger asChild>
              <Button className="h-10 gap-2 px-4 text-sm sm:min-h-0">
                <Plus className="h-4 w-4 shrink-0" /> Přidat doklad
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[min(100%,28rem)] max-w-[28rem] overflow-y-auto border border-gray-200 bg-white p-0 text-gray-950 shadow-lg sm:rounded-xl">
              <DialogHeader className="space-y-1 border-b border-gray-100 px-4 pb-3 pt-4 sm:px-5">
                <DialogTitle className="text-lg font-semibold text-gray-950">
                  Nový obchodní doklad
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-800">
                  Zadejte údaje z faktury, dokladu nebo dodacího listu.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddDocument} className="space-y-3 px-4 py-3 sm:px-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {newDocKind === "document" ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Druh záznamu</Label>
                    <Select
                      value={newDocKind}
                      onValueChange={(v) =>
                        setNewDocKind(v === "delivery_note" ? "delivery_note" : "document")
                      }
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="document">Doklad</SelectItem>
                        <SelectItem value="delivery_note">Dodací list</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="attachment">Soubor / fotka / PDF</Label>
                    <Input
                      id="attachment"
                      type="file"
                      accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                      capture="environment"
                      onChange={(e) => setNewDocFile(e.target.files?.[0] ?? null)}
                      className="bg-background"
                    />
                    <p className="text-xs text-muted-foreground">
                      Na mobilu lze využít fotoaparát a doklad nahrát přímo z terénu.
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Typ dokladu</Label>
                    <div className="flex gap-2 p-1 bg-background rounded-lg border border-border">
                      <Button
                        type="button"
                        variant={newDocType === "received" ? "default" : "ghost"}
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType("received")}
                      >
                        Přijatý (Náklad)
                      </Button>
                      <Button
                        type="button"
                        variant={newDocType === "issued" ? "default" : "ghost"}
                        className="flex-1 h-8 text-xs"
                        onClick={() => setNewDocType("issued")}
                      >
                        Vydaný (Příjem)
                      </Button>
                    </div>
                  </div>
                  {newDocKind === "delivery_note" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Přiřadit k faktuře (volitelné)</Label>
                      <Select value={selectedInvoiceId || "__none__"} onValueChange={(v) => setSelectedInvoiceId(v === "__none__" ? "" : v)}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Není přiřazeno k faktuře" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Není přiřazeno k faktuře</SelectItem>
                          {invoiceSelectOptions.map((inv) => (
                            <SelectItem key={inv.id} value={inv.id}>
                              {inv.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <Label htmlFor="number">Číslo dokladu</Label>
                    <Input
                      id="number"
                      value={formData.number}
                      onChange={(e) =>
                        setFormData({ ...formData, number: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="date">Datum vystavení</Label>
                    <Input
                      id="date"
                      type="date"
                      required
                      value={formData.date}
                      onChange={(e) =>
                        setFormData({ ...formData, date: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  {newDocKind !== "delivery_note" ? (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="entityName">
                      {newDocType === "received" ? "Dodavatel" : "Odběratel"}
                    </Label>
                    <Input
                      id="entityName"
                      value={formData.entityName}
                      onChange={(e) =>
                        setFormData({ ...formData, entityName: e.target.value })
                      }
                      className="bg-background"
                    />
                  </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                      <div className="space-y-2">
                        <Label htmlFor="amount">Částka bez DPH</Label>
                        <Input
                          id="amount"
                          type="number"
                          min={0}
                          step={formData.currency === "EUR" ? "0.01" : "1"}
                          placeholder="0 = jen fotodokumentace (u zakázky)"
                          value={formData.amount}
                          onChange={(e) =>
                            setFormData({ ...formData, amount: e.target.value })
                          }
                          className="bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="doc-currency">Měna</Label>
                        <Select
                          value={formData.currency}
                          onValueChange={(v) =>
                            setFormData({
                              ...formData,
                              currency: v === "EUR" ? "EUR" : "CZK",
                            })
                          }
                        >
                          <SelectTrigger id="doc-currency" className="bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CZK">CZK</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Bez částky se neuloží jako doklad. S výběrem zakázky (náklad) se soubor uloží jen
                      jako fotodokumentace u zakázky — v tomto seznamu dokladů se neobjeví.
                    </p>
                  </div>
                  {newDocKind !== "delivery_note" ? (
                  <div className="space-y-2">
                    <Label htmlFor="vat">DPH</Label>
                    <Select
                      value={formData.vat}
                      onValueChange={(v) =>
                        setFormData({ ...formData, vat: v })
                      }
                    >
                      <SelectTrigger id="vat" className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VAT_RATE_OPTIONS.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r} % DPH
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="description">Popis / Poznámka</Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
                      className="bg-background"
                    />
                  </div>
                  {newDocKind !== "delivery_note" ? (
                    <div className="space-y-3 sm:col-span-2 rounded-lg border-2 border-primary/25 bg-primary/[0.04] p-3 shadow-sm">
                      <div className="space-y-1">
                        <Label className="text-base font-semibold text-gray-950">
                          Stav úhrady (před uložením)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Stejná pole jako při pozdějším „Označit jako zaplaceno“. Neuhrazeno = bez
                          údajů o platbě.
                        </p>
                      </div>
                      <div
                        className="flex flex-col gap-2 sm:flex-row"
                        role="group"
                        aria-label="Stav úhrady dokladu"
                      >
                        <Button
                          type="button"
                          variant={formData.paymentStatus === "unpaid" ? "default" : "outline"}
                          className={cn(
                            "min-h-11 flex-1 touch-manipulation sm:min-h-9",
                            formData.paymentStatus === "unpaid" && "shadow-sm"
                          )}
                          onClick={() =>
                            setFormData({
                              ...formData,
                              paymentStatus: "unpaid",
                              paidAt: "",
                              paidAmount: "",
                            })
                          }
                        >
                          Neuhrazeno
                        </Button>
                        <Button
                          type="button"
                          variant={formData.paymentStatus === "partial" ? "default" : "outline"}
                          className={cn(
                            "min-h-11 flex-1 touch-manipulation sm:min-h-9",
                            formData.paymentStatus === "partial" && "shadow-sm"
                          )}
                          onClick={() =>
                            setFormData({
                              ...formData,
                              paymentStatus: "partial",
                              paidAt: formData.paidAt || todayIso,
                              paidAmount: formData.paidAmount,
                            })
                          }
                        >
                          Částečně uhrazeno
                        </Button>
                        <Button
                          type="button"
                          variant={formData.paymentStatus === "paid" ? "default" : "outline"}
                          className={cn(
                            "min-h-11 flex-1 touch-manipulation sm:min-h-9",
                            formData.paymentStatus === "paid" && "shadow-sm"
                          )}
                          onClick={() =>
                            setFormData({
                              ...formData,
                              paymentStatus: "paid",
                              paidAt: formData.paidAt || todayIso,
                              paidAmount: "",
                            })
                          }
                        >
                          Uhrazeno
                        </Button>
                      </div>

                      {formData.paymentStatus === "paid" || formData.paymentStatus === "partial" ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {formData.paymentStatus === "partial" ? (
                            <div className="space-y-2">
                              <Label>Uhrazená částka</Label>
                              <Input
                                type="number"
                                min={0}
                                step={formData.currency === "EUR" ? "0.01" : "1"}
                                value={formData.paidAmount}
                                onChange={(e) =>
                                  setFormData({ ...formData, paidAmount: e.target.value })
                                }
                                className="bg-background tabular-nums"
                              />
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <Label>Uhrazená částka</Label>
                              <Input
                                value="(automaticky celá částka)"
                                disabled
                                className="bg-background"
                              />
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label>Datum úhrady</Label>
                            <Input
                              type="date"
                              value={formData.paidAt}
                              onChange={(e) =>
                                setFormData({ ...formData, paidAt: e.target.value })
                              }
                              className="bg-background"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Způsob úhrady (volitelné)</Label>
                            <Select
                              value={formData.paymentMethod}
                              onValueChange={(v) =>
                                setFormData({
                                  ...formData,
                                  paymentMethod:
                                    v === "cash" || v === "bank" || v === "card" || v === "other"
                                      ? (v as "cash" | "bank" | "card" | "other")
                                      : "bank",
                                })
                              }
                            >
                              <SelectTrigger className="bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cash">Hotově</SelectItem>
                                <SelectItem value="bank">Převodem</SelectItem>
                                <SelectItem value="card">Kartou</SelectItem>
                                <SelectItem value="other">Jinak</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>Poznámka k úhradě (volitelné)</Label>
                            <Input
                              value={formData.paymentNote}
                              onChange={(e) =>
                                setFormData({ ...formData, paymentNote: e.target.value })
                              }
                              className="bg-background"
                              placeholder="např. VS, poznámka…"
                            />
                          </div>
                          {formData.paymentStatus === "partial" ? (
                            <p className="sm:col-span-2 text-xs text-muted-foreground tabular-nums">
                              {(() => {
                                const pa =
                                  formData.paidAmount.trim() === ""
                                    ? 0
                                    : Number(
                                        String(formData.paidAmount).replace(",", ".")
                                      );
                                const paid = Number.isFinite(pa) ? roundMoney2(pa) : 0;
                                const rest = roundMoney2(
                                  Math.max(0, newDocGrossPreview - paid)
                                );
                                const cur = formData.currency === "EUR" ? "€" : "Kč";
                                return `Zbývá doplatit: ${rest.toLocaleString(
                                  "cs-CZ"
                                )} ${cur}`;
                              })()}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {formData.paymentStatus === "paid" && newDocGrossPreview > 0 ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Při uložení se nastaví úhrada v plné výši{" "}
                          {newDocGrossPreview.toLocaleString("cs-CZ")}{" "}
                          {formData.currency === "EUR" ? "€" : "Kč"} (s DPH).
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {newDocKind !== "delivery_note" ? (
                    <div className="space-y-3 sm:col-span-2 rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <Label htmlFor="requires-payment-new" className="text-base">
                            K úhradě
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Zobrazí v přehledu Nutno uhradit na hlavní stránce (vyžaduje částku).
                          </p>
                        </div>
                        <Switch
                          id="requires-payment-new"
                          checked={formData.requiresPayment}
                          onCheckedChange={(v) =>
                            setFormData({ ...formData, requiresPayment: v })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="due-date-new">Splatnost</Label>
                        <Input
                          id="due-date-new"
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) =>
                            setFormData({ ...formData, dueDate: e.target.value })
                          }
                          className="bg-background"
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Zařazení dokladu</Label>
                    <Select
                      value={assignmentType}
                      onValueChange={(v) => setAssignmentType(v as AssignmentType)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="job_cost">Zakázka → náklad</SelectItem>
                        <SelectItem value="company">Firma (doklady firmy)</SelectItem>
                        <SelectItem value="warehouse">Sklad</SelectItem>
                        <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignmentType === "job_cost" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Vyberte zakázku</Label>
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Zakázka" />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {assignmentType === "warehouse" ? (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Sklad</Label>
                      <Input
                        value={selectedWarehouseId}
                        onChange={(e) => setSelectedWarehouseId(e.target.value)}
                        placeholder="ID skladu (výchozí: main)"
                        className="bg-background"
                      />
                    </div>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "Uložit doklad"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="outlineLight" className="gap-2 min-h-[44px]">
            <Upload className="w-4 h-4 shrink-0" /> Nahrát PDF
          </Button>
        </div>
      </div>

      {pendingDocs.length > 0 ? (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTitle>Nezařazené doklady ({pendingDocs.length})</AlertTitle>
          <AlertDescription>
            Doklady ve stavu „musí se zařadit později“ jsou zvýrazněné a lze je rychle zařadit.
          </AlertDescription>
        </Alert>
      ) : null}

      {paymentOverviewStats.toPay > 0 ? (
        <Card className="border-gray-300 bg-white text-gray-900 shadow-sm">
          <CardContent className="py-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Souhrn k úhradě
            </p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              <span>
                Dokladů k úhradě:{" "}
                <strong className="tabular-nums">{paymentOverviewStats.toPay}</strong>
              </span>
              <span>
                Celkem:{" "}
                <strong className="tabular-nums">
                  {Math.round(paymentOverviewStats.totalKc).toLocaleString("cs-CZ")} Kč
                </strong>
              </span>
              <button
                type="button"
                onClick={onPaymentOverdueSummaryClick}
                className={cn(
                  "inline-flex max-w-full flex-wrap items-baseline gap-x-1 rounded-md border px-2 py-1 text-left text-sm transition-colors",
                  paymentOverviewStats.overdueTotal > 0
                    ? "cursor-pointer border-red-200 bg-red-50 text-red-900 hover:bg-red-100"
                    : "cursor-pointer border-transparent text-gray-600 hover:bg-gray-50",
                  documentsPaymentFilter === "overdue" &&
                    paymentOverviewStats.overdueTotal > 0 &&
                    "ring-2 ring-red-400/60"
                )}
                title={
                  paymentOverviewStats.overdueTotal > 0
                    ? `Doklady: ${paymentOverviewStats.overdueDocuments}, faktury: ${paymentOverviewStats.overdueInvoices}. Kliknutím nastavíte filtr „po splatnosti“, zruší se hledání v tabulkách a zvýrazní se první položka.`
                    : "Kliknutím ověříte stav"
                }
              >
                <span className="font-normal">Po splatnosti:</span>{" "}
                <strong className="tabular-nums">
                  {paymentOverviewStats.overdueTotal}
                </strong>
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs
        value={documentsMainTab}
        onValueChange={setDocumentsMainTab}
        className="w-full min-w-0"
      >
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 mb-6">
          <TabsTrigger
            value="all"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0 text-slate-600" /> Všechny
            doklady
          </TabsTrigger>
          <TabsTrigger
            value="received"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0" /> Přijaté doklady
          </TabsTrigger>
          <TabsTrigger
            value="issued"
            className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
          >
            <FileText className="w-4 h-4 shrink-0 text-emerald-500" /> Vydané
            doklady
          </TabsTrigger>
          {canSoftDelete ? (
            <TabsTrigger
              value="trash"
              className="gap-2 min-h-[44px] sm:min-h-0 flex-1 sm:flex-initial"
            >
              <Trash2 className="w-4 h-4 shrink-0 text-slate-500" />
              Koš
            </TabsTrigger>
          ) : null}
        </TabsList>

        {documentsMainTab !== "trash" && documentsPaymentFilter === "overdue" ? (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950"
          >
            <span>
              Aktivní filtr: <strong>Po splatnosti</strong> — v souhrnu shoda{" "}
              <strong className="tabular-nums">
                {paymentOverviewStats.overdueTotal}
              </strong>{" "}
              položek (doklady {paymentOverviewStats.overdueDocuments}, faktury{" "}
              {paymentOverviewStats.overdueInvoices}). Stejná logika jako u badge
              nahoře.
              {paymentFlashRowKey ? (
                <>
                  {" "}
                  Zvýrazněný řádek odpovídá první položce po splatnosti
                  {paymentFlashRowKey.startsWith("inv:") ? " (faktura)" : ""}.
                </>
              ) : null}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-red-300 bg-white text-red-900 hover:bg-red-100"
              onClick={() => {
                setDocumentsPaymentFilter("__all__");
                setPaymentFlashRowKey(null);
              }}
            >
              Zrušit filtr
            </Button>
          </div>
        ) : null}

        <TabsContent value="all" className="space-y-10">
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Přijaté doklady
            </h2>
            <DocumentTableReceived
              key={`dtr-all-rcv-${paymentTableMountKey}`}
              flashDomScope="all-received"
              paymentFlashRowKey={paymentFlashRowKey}
              data={receivedDocsBase}
              jobNamesById={jobNamesById}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={receivedSearch}
              onSearchChange={setReceivedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash={false}
              showDeleteButton={canSoftDelete}
              paymentFilter={documentsPaymentFilter}
              onPaymentFilterChange={setDocumentsPaymentFilter}
            />
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Vydané doklady a faktury
            </h2>
            <DocumentTableIssued
              key={`dti-all-iss-${paymentTableMountKey}`}
              flashDomScope="all-issued"
              paymentFlashRowKey={paymentFlashRowKey}
              data={issuedDocs}
              invoices={issuedInvoicesFiltered}
              isLoadingInvoices={isInvoicesLoading}
              jobs={jobs}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onDeleteInvoice={requestDeleteInvoice}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={issuedSearch}
              onSearchChange={setIssuedSearch}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash={false}
              showDeleteButton={canSoftDelete}
              todayIso={todayIso}
              paymentFilter={documentsPaymentFilter}
              onPaymentFilterChange={setDocumentsPaymentFilter}
            />
          </section>
        </TabsContent>

        <TabsContent value="received">
          <DocumentTableReceived
            key={`dtr-received-${paymentTableMountKey}`}
            flashDomScope="received"
            paymentFlashRowKey={paymentFlashRowKey}
            data={receivedDocsBase}
            jobNamesById={jobNamesById}
            isLoading={isLoading}
            onDelete={requestDeleteDocument}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
            search={receivedSearch}
            onSearchChange={setReceivedSearch}
            todayIso={todayIso}
            onMarkPaid={markDocumentPaid}
            onMarkUnpaid={markDocumentUnpaid}
            readOnlyTrash={false}
            showDeleteButton={canSoftDelete}
            paymentFilter={documentsPaymentFilter}
            onPaymentFilterChange={setDocumentsPaymentFilter}
          />
        </TabsContent>

        <TabsContent value="issued">
          <DocumentTableIssued
            key={`dti-issued-${paymentTableMountKey}`}
            flashDomScope="issued"
            paymentFlashRowKey={paymentFlashRowKey}
            data={issuedDocs}
            invoices={issuedInvoicesFiltered}
            isLoadingInvoices={isInvoicesLoading}
            jobs={jobs}
            isLoading={isLoading}
            onDelete={requestDeleteDocument}
            onDeleteInvoice={requestDeleteInvoice}
            onEdit={openEditDocument}
            onAssign={openAssignDialog}
            search={issuedSearch}
            onSearchChange={setIssuedSearch}
            onMarkPaid={markDocumentPaid}
            onMarkUnpaid={markDocumentUnpaid}
            readOnlyTrash={false}
            showDeleteButton={canSoftDelete}
            todayIso={todayIso}
            paymentFilter={documentsPaymentFilter}
            onPaymentFilterChange={setDocumentsPaymentFilter}
          />
        </TabsContent>

        <TabsContent value="trash" className="space-y-8">
          <Alert className="border-gray-200 bg-gray-50 text-gray-900">
            <AlertTitle>Koš</AlertTitle>
            <AlertDescription>
              Doklady a faktury zůstávají uložené ve Firestore a přílohy ve Storage; v běžných
              přehledech se už nezobrazují.
            </AlertDescription>
          </Alert>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Smazané přijaté doklady
            </h2>
            <DocumentTableReceived
              flashDomScope="trash-received"
              paymentFlashRowKey={null}
              data={receivedDocsBase}
              jobNamesById={jobNamesById}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={receivedSearch}
              onSearchChange={setReceivedSearch}
              todayIso={todayIso}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash
              showDeleteButton={false}
              paymentFilter={documentsPaymentFilter}
              onPaymentFilterChange={setDocumentsPaymentFilter}
            />
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-gray-950">
              Smazané vydané doklady a faktury
            </h2>
            <DocumentTableIssued
              flashDomScope="trash-issued"
              paymentFlashRowKey={null}
              data={issuedDocs}
              invoices={issuedInvoicesFiltered}
              isLoadingInvoices={isInvoicesLoading}
              jobs={jobs}
              isLoading={isLoading}
              onDelete={requestDeleteDocument}
              onDeleteInvoice={requestDeleteInvoice}
              onEdit={openEditDocument}
              onAssign={openAssignDialog}
              search={issuedSearch}
              onSearchChange={setIssuedSearch}
              onMarkPaid={markDocumentPaid}
              onMarkUnpaid={markDocumentUnpaid}
              readOnlyTrash
              showDeleteButton={false}
              todayIso={todayIso}
              paymentFilter={documentsPaymentFilter}
              onPaymentFilterChange={setDocumentsPaymentFilter}
            />
          </section>
        </TabsContent>
      </Tabs>

      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Zařadit doklad</DialogTitle>
            <DialogDescription>
              Nastavte, kam doklad patří: zakázka, režie nebo ponechat na později.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Zařazení</Label>
              <Select
                value={assignTypeNext}
                onValueChange={(v) => setAssignTypeNext(v as AssignmentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="job_cost">Zakázka → náklad</SelectItem>
                  <SelectItem value="company">Firma (doklady firmy)</SelectItem>
                  <SelectItem value="warehouse">Sklad</SelectItem>
                  <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignTypeNext === "job_cost" ? (
              <div className="space-y-2">
                <Label>Zakázka</Label>
                <Select value={assignJobIdNext} onValueChange={setAssignJobIdNext}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte zakázku" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Zrušit
            </Button>
            <Button onClick={() => void saveAssignment()}>Uložit zařazení</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) {
            setEditRow(null);
            setEditInvoiceId("");
            setEditAssignmentType("pending_assignment");
            setEditWarehouseId("");
            setEditSupplier("");
            setEditSplitToJobs(false);
            setEditAllocMode("amount");
            setEditAllocRows([]);
          }
        }}
      >
        <DialogContent
          className={cn(
            "bg-white border-slate-200 text-slate-900 w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto",
            isEditingDeliveryNote ? "max-w-lg" : "max-w-2xl"
          )}
        >
          <DialogHeader>
            <DialogTitle>Upravit doklad</DialogTitle>
            <DialogDescription>
              {isEditingDeliveryNote
                ? "Upravte dodací list, přiřazení a vazbu na fakturu."
                : "Upravte název, částku, DPH, datum a přiřazení k zakázce."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditDocument} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-nazev">Název</Label>
              <Input
                id="edit-nazev"
                value={editForm.nazev}
                onChange={(e) =>
                  setEditForm({ ...editForm, nazev: e.target.value })
                }
                className="bg-background"
                required
              />
            </div>
            {!isEditingDeliveryNote ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
              <div className="space-y-2">
                <Label htmlFor="edit-castka">
                  {editForm.sDPH ? "Částka bez DPH (základ)" : "Částka"}
                </Label>
                <Input
                  id="edit-castka"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={editForm.castka}
                  onChange={(e) =>
                    setEditForm({ ...editForm, castka: e.target.value })
                  }
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-currency">Měna</Label>
                <Select
                  value={editForm.currency}
                  onValueChange={(v) =>
                    setEditForm({
                      ...editForm,
                      currency: v === "EUR" ? "EUR" : "CZK",
                    })
                  }
                >
                  <SelectTrigger id="edit-currency" className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CZK">CZK</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            ) : null}
            {!isEditingDeliveryNote && editRow?.currency === "EUR" && editRow.exchangeRate ? (
              <p className="text-xs text-muted-foreground">
                Uložený kurz: 1 EUR = {Number(editRow.exchangeRate).toLocaleString("cs-CZ")}{" "}
                Kč (při úpravě se nemění).
              </p>
            ) : null}
            {!isEditingDeliveryNote ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-sdph" className="text-sm font-medium">
                  DPH
                </Label>
                <p className="text-xs text-muted-foreground">
                  Zapnuto: ukládá se základ, DPH a částka s DPH. Vypnuto: jen jedna
                  částka.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm text-muted-foreground">bez DPH</span>
                <Switch
                  id="edit-sdph"
                  checked={editForm.sDPH}
                  onCheckedChange={(v) => setEditForm({ ...editForm, sDPH: v })}
                />
                <span className="text-sm font-medium">s DPH</span>
              </div>
            </div>
            ) : null}
            {!isEditingDeliveryNote && editForm.sDPH ? (
              <div className="space-y-2">
                <Label htmlFor="edit-dph">Sazba DPH (%)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[21, 15, 12, 0].map((r) => (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={
                        String(editForm.dphSazba) === String(r)
                          ? "default"
                          : "outline"
                      }
                      className="h-8 text-xs"
                      onClick={() =>
                        setEditForm({ ...editForm, dphSazba: String(r) })
                      }
                    >
                      {r} %
                    </Button>
                  ))}
                </div>
                <Input
                  id="edit-dph"
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  placeholder="Vlastní sazba (např. 10)"
                  value={editForm.dphSazba}
                  onChange={(e) =>
                    setEditForm({ ...editForm, dphSazba: e.target.value })
                  }
                  className="bg-background"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="edit-date">Datum</Label>
              <Input
                id="edit-date"
                type="date"
                required
                value={editForm.date}
                onChange={(e) =>
                  setEditForm({ ...editForm, date: e.target.value })
                }
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-poznamka">Poznámka</Label>
              <Textarea
                id="edit-poznamka"
                rows={3}
                value={editForm.poznamka}
                onChange={(e) =>
                  setEditForm({ ...editForm, poznamka: e.target.value })
                }
                className="bg-background resize-y min-h-[80px]"
              />
            </div>
            {isEditingDeliveryNote ? (
              <>
                <div className="space-y-2">
                  <Label>Dodavatel</Label>
                  <Input
                    value={editSupplier}
                    onChange={(e) => setEditSupplier(e.target.value)}
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Přiřazení k faktuře</Label>
                  <Select
                    value={editInvoiceId || "__none__"}
                    onValueChange={(v) => setEditInvoiceId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Není přiřazeno k faktuře" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Není přiřazeno k faktuře</SelectItem>
                      {invoiceSelectOptions.map((inv) => (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Zařazení dokladu</Label>
                  <Select
                    value={editAssignmentType}
                    onValueChange={(v) => setEditAssignmentType(v as AssignmentType)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending_assignment">Nezařazený (později)</SelectItem>
                      <SelectItem value="job_cost">Zakázka</SelectItem>
                      <SelectItem value="company">Firma</SelectItem>
                      <SelectItem value="warehouse">Sklad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editAssignmentType === "warehouse" ? (
                  <div className="space-y-2">
                    <Label>ID skladu</Label>
                    <Input
                      value={editWarehouseId}
                      onChange={(e) => setEditWarehouseId(e.target.value)}
                      placeholder="main"
                      className="bg-background"
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {!isEditingDeliveryNote ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Label htmlFor="edit-requires-payment">K úhradě</Label>
                  <p className="text-xs text-muted-foreground">
                    Přehled na hlavní stránce a splatnost.
                  </p>
                </div>
                <Switch
                  id="edit-requires-payment"
                  checked={editForm.requiresPayment}
                  onCheckedChange={(v) =>
                    setEditForm({ ...editForm, requiresPayment: v })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-due-date">Splatnost</Label>
                <Input
                  id="edit-due-date"
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, dueDate: e.target.value })
                  }
                  className="bg-background"
                />
              </div>
              {editRow?.paid === true ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                  <p className="font-medium">Zaplaceno</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => editRow && void markDocumentUnpaid(editRow)}
                  >
                    Označit jako nezaplaceno
                  </Button>
                </div>
              ) : editRow &&
                editForm.requiresPayment &&
                docDisplayAmounts(editRow).amountGross > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => editRow && void markDocumentPaid(editRow)}
                >
                  Označit jako zaplaceno
                </Button>
              ) : null}
            </div>
            ) : null}
            {isEditingDeliveryNote ? (
              <div className="space-y-2">
                <Label>Zakázka</Label>
                {editAssignmentType !== "job_cost" ? (
                  <p className="text-xs text-muted-foreground">
                    Doklad není zařazen k zakázce.
                  </p>
                ) : null}
                <Select
                  value={editForm.zakazkaId || "__none__"}
                  onValueChange={(v) =>
                    setEditForm({
                      ...editForm,
                      zakazkaId: v === "__none__" ? "" : v,
                    })
                  }
                  disabled={editAssignmentType !== "job_cost"}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Nepřiřazeno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— bez zakázky —</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border p-3">
                {editRow && isReceivedDoc(editRow) ? (
                  <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-0.5 min-w-0">
                    <Label htmlFor="edit-split-jobs">Rozdělení nákladu na zakázky</Label>
                    <p className="text-xs text-muted-foreground">
                      Více zakázek nebo část jako režie. Režim částky: součet řádků = hrubá částka
                      dokladu v CZK. Režim procenta: součet = 100 %. Bez zapnutí zůstává chování jako
                      jedna zakázka níže.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                    <Switch
                      id="edit-split-jobs"
                      checked={editSplitToJobs}
                      onCheckedChange={(v) => {
                        setEditSplitToJobs(v);
                        if (v && editAllocRows.length === 0 && editRow) {
                          const basis = previewEditDocumentGrossCzk(
                            editRow,
                            editForm
                          );
                          const jid = editForm.zakazkaId.trim();
                          setEditAllocMode("amount");
                          setEditAllocRows([
                            {
                              id: makeJobCostAllocationId(),
                              kind: "job",
                              jobId: jid,
                              amount: basis > 0 ? String(basis) : "",
                              percent: "",
                              note: "",
                            },
                          ]);
                        }
                        if (!v) {
                          setEditAllocRows([]);
                          setEditAllocMode("amount");
                        }
                      }}
                    />
                    {editSplitToJobs ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="whitespace-nowrap"
                        onClick={() => {
                          setEditSplitToJobs(false);
                          setEditAllocRows([]);
                          setEditAllocMode("amount");
                        }}
                      >
                        Odstranit rozdělení
                      </Button>
                    ) : null}
                  </div>
                </div>
                {editSplitToJobs ? (
                  <div className="space-y-3 border-t border-border pt-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div className="space-y-1.5">
                        <Label>Rozdělení podle</Label>
                        <Select
                          value={editAllocMode}
                          onValueChange={(x) =>
                            setEditAllocMode(x as JobCostAllocationMode)
                          }
                        >
                          <SelectTrigger className="bg-background max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="amount">
                              Částky (Kč, hrubá po DPH jako u dokladu)
                            </SelectItem>
                            <SelectItem value="percent">Procenta (100 % celkem)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="text-sm">
                        {editSplitRemainder.kind === "amount" ? (
                          <span
                            className={cn(
                              "font-medium tabular-nums",
                              Math.abs(editSplitRemainder.value) <= 0.05
                                ? "text-emerald-700"
                                : "text-amber-900"
                            )}
                          >
                            Zbývá rozdělit:{" "}
                            {editSplitRemainder.value.toLocaleString("cs-CZ")} Kč
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "font-medium tabular-nums",
                              Math.abs(editSplitRemainder.value) <= 0.05
                                ? "text-emerald-700"
                                : "text-amber-900"
                            )}
                          >
                            Zbývá: {editSplitRemainder.value.toLocaleString("cs-CZ")}{" "}
                            %
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setEditAllocRows((rs) => [
                            ...rs,
                            {
                              id: makeJobCostAllocationId(),
                              kind: "job",
                              jobId: "",
                              amount: "",
                              percent: "",
                              note: "",
                            },
                          ])
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Přidat zakázku
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setEditAllocRows((rs) => [
                            ...rs,
                            {
                              id: makeJobCostAllocationId(),
                              kind: "overhead",
                              jobId: "",
                              amount: "",
                              percent: "",
                              note: "",
                            },
                          ])
                        }
                      >
                        <Plus className="h-3.5 w-3.5" /> Přidat režii
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fillEditAllocRemainder()}
                        disabled={editAllocRows.length === 0}
                      >
                        Doplnit zbytek do posledního řádku
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {editAllocRows.map((ar, idx) => (
                        <div
                          key={ar.id}
                          className="grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/30 p-2 sm:grid-cols-12 sm:items-end"
                        >
                          <div className="sm:col-span-3">
                            <Label className="text-xs text-muted-foreground">
                              Typ
                            </Label>
                            <Select
                              value={ar.kind}
                              onValueChange={(x) =>
                                setEditAllocRows((rs) =>
                                  rs.map((r) =>
                                    r.id === ar.id
                                      ? {
                                          ...r,
                                          kind: x as "job" | "overhead",
                                          jobId:
                                            x === "overhead" ? "" : r.jobId,
                                        }
                                      : r
                                  )
                                )
                              }
                            >
                              <SelectTrigger className="bg-background h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="job">Zakázka</SelectItem>
                                <SelectItem value="overhead">Režie</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {ar.kind === "job" ? (
                            <div className="sm:col-span-4">
                              <Label className="text-xs text-muted-foreground">
                                Zakázka
                              </Label>
                              <Select
                                value={ar.jobId || "__none__"}
                                onValueChange={(v) =>
                                  setEditAllocRows((rs) =>
                                    rs.map((r) =>
                                      r.id === ar.id
                                        ? {
                                            ...r,
                                            jobId: v === "__none__" ? "" : v,
                                          }
                                        : r
                                    )
                                  )
                                }
                              >
                                <SelectTrigger className="bg-background h-9">
                                  <SelectValue placeholder="Vyberte" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">—</SelectItem>
                                  {jobs.map((j) => (
                                    <SelectItem key={j.id} value={j.id}>
                                      {j.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                            <div className="sm:col-span-4 text-xs text-muted-foreground pb-2">
                              Režijní podíl (nepřiřazeno k zakázce)
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">
                              {editAllocMode === "amount" ? "Kč" : "%"}
                            </Label>
                            <Input
                              className="bg-background h-9 tabular-nums"
                              type="number"
                              min={0}
                              step={editAllocMode === "amount" ? "0.01" : "0.1"}
                              value={
                                editAllocMode === "amount"
                                  ? ar.amount
                                  : ar.percent
                              }
                              onChange={(e) =>
                                setEditAllocRows((rs) =>
                                  rs.map((r) =>
                                    r.id === ar.id
                                      ? editAllocMode === "amount"
                                        ? { ...r, amount: e.target.value }
                                        : { ...r, percent: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">
                              Pozn.
                            </Label>
                            <Input
                              className="bg-background h-9"
                              value={ar.note}
                              onChange={(e) =>
                                setEditAllocRows((rs) =>
                                  rs.map((r) =>
                                    r.id === ar.id
                                      ? { ...r, note: e.target.value }
                                      : r
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="sm:col-span-1 flex sm:justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-destructive"
                              title="Odstranit řádek"
                              disabled={editAllocRows.length <= 1}
                              onClick={() =>
                                setEditAllocRows((rs) =>
                                  rs.filter((r) => r.id !== ar.id)
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="sm:col-span-12 text-[11px] text-muted-foreground">
                            Řádek {idx + 1}
                          </p>
                        </div>
                      ))}
                    </div>
                    {editAllocDuplicateJobIds.length > 0 ? (
                      <Alert variant="destructive" className="py-2">
                        <AlertTitle>Duplicitní zakázka</AlertTitle>
                        <AlertDescription>
                          Stejná zakázka je ve více řádcích — sloučte je nebo zvolte jiné zakázky.
                          Uložení není možné.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {editAllocSavePreview &&
                    editAllocSavePreview.basis > 0 &&
                    !editAllocSavePreview.val.ok ? (
                      <Alert className="border-amber-300 bg-amber-50 py-2 text-amber-950">
                        <AlertTitle>Rozdělení neodpovídá dokladu</AlertTitle>
                        <AlertDescription>
                          {editAllocSavePreview.val.ok === false
                            ? editAllocSavePreview.val.message
                            : ""}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {editAllocSavePreview && editAllocSavePreview.basis > 0 ? (
                      <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-sm">
                        <p className="text-xs font-semibold text-foreground">Souhrn rozdělení</p>
                        <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                          <div className="tabular-nums">
                            Celková částka dokladu (CZK):{" "}
                            <span className="font-semibold">
                              {editAllocSavePreview.basis.toLocaleString("cs-CZ")} Kč
                            </span>
                          </div>
                          <div className="tabular-nums">
                            Rozděleno (CZK):{" "}
                            <span className="font-semibold">
                              {editAllocSavePreview.allocatedCzk.toLocaleString("cs-CZ")} Kč
                            </span>
                          </div>
                          {editAllocMode === "amount" ? (
                            <div className="tabular-nums sm:col-span-2">
                              Zbývá rozdělit:{" "}
                              <span
                                className={cn(
                                  "font-semibold",
                                  Math.abs(editAllocSavePreview.remainderCzk) <= 0.05
                                    ? "text-emerald-700"
                                    : "text-amber-900"
                                )}
                              >
                                {editAllocSavePreview.remainderCzk.toLocaleString("cs-CZ")} Kč
                              </span>
                            </div>
                          ) : (
                            <div className="tabular-nums sm:col-span-2">
                              Součet procent:{" "}
                              <span
                                className={cn(
                                  "font-semibold",
                                  Math.abs(editAllocSavePreview.sumPct - 100) <= 0.05
                                    ? "text-emerald-700"
                                    : "text-amber-900"
                                )}
                              >
                                {editAllocSavePreview.sumPct.toLocaleString("cs-CZ")} % (cíl 100 %)
                              </span>
                            </div>
                          )}
                        </div>
                        <p className="border-t border-border/60 pt-1 text-xs font-medium">
                          Stav validace:{" "}
                          {editAllocSavePreview.val.ok &&
                          editAllocDuplicateJobIds.length === 0 ? (
                            <span className="text-emerald-700">OK — lze uložit</span>
                          ) : (
                            <span className="text-destructive">
                              Nelze uložit — opravte rozdělení nebo duplicity
                            </span>
                          )}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                  </>
                ) : null}
                {!editRow ||
                !isReceivedDoc(editRow) ||
                !editSplitToJobs ? (
                  <>
                    <div
                      className={cn(
                        "space-y-2",
                        editRow && isReceivedDoc(editRow)
                          ? "border-t border-border pt-3"
                          : ""
                      )}
                    >
                      <Label>Zakázka</Label>
                      <Select
                        value={editForm.zakazkaId || "__none__"}
                        onValueChange={(v) =>
                          setEditForm({
                            ...editForm,
                            zakazkaId: v === "__none__" ? "" : v,
                          })
                        }
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Nepřiřazeno" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— bez zakázky —</SelectItem>
                          {jobs.map((j) => (
                            <SelectItem key={j.id} value={j.id}>
                              {j.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!editForm.zakazkaId.trim() ? (
                        <div className="space-y-2 rounded-md border border-border p-3">
                          <Label className="text-xs text-muted-foreground">
                            Bez zakázky
                          </Label>
                          <Select
                            value={editForm.noJobMode}
                            onValueChange={(v) =>
                              setEditForm({
                                ...editForm,
                                noJobMode: v as "pending" | "overhead",
                              })
                            }
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">
                                Musí se zařadit později
                              </SelectItem>
                              <SelectItem value="overhead">Režie</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditOpen(false);
                }}
              >
                Zrušit
              </Button>
              <Button type="submit" disabled={isEditSaving}>
                {isEditSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Uložit"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat doklad?</AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <span>
                Chceš opravdu smazat tento doklad? Akci nelze vrátit.
              </span>
              {deleteTarget ? (
                <span className="block font-medium text-foreground">
                  „{docDisplayTitle(deleteTarget)}“
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                void performDeleteDocument();
              }}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Smazat"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteInvoiceOpen} onOpenChange={setDeleteInvoiceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat fakturu?</AlertDialogTitle>
            <AlertDialogDescription className="text-left space-y-2">
              <span>
                Chceš opravdu smazat tento doklad? Akci nelze vrátit.
              </span>
              {deleteInvoiceTarget ? (
                <span className="block font-medium text-foreground">
                  „{deleteInvoiceTarget.label}“
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingInvoice}>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingInvoice}
              onClick={(e) => {
                e.preventDefault();
                void performDeleteInvoice();
              }}
            >
              {isDeletingInvoice ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Smazat"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}

function DocumentTableReceived({
  data,
  jobNamesById,
  isLoading,
  onDelete,
  onEdit,
  onAssign,
  search,
  onSearchChange,
  todayIso,
  onMarkPaid,
  onMarkUnpaid,
  readOnlyTrash = false,
  showDeleteButton = true,
  paymentFilter,
  onPaymentFilterChange,
  flashDomScope,
  paymentFlashRowKey = null,
}: {
  data: CompanyDocumentRow[];
  jobNamesById: Map<string, string>;
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onEdit: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
  todayIso: string;
  onMarkPaid: (row: CompanyDocumentRow) => void | Promise<void>;
  onMarkUnpaid: (row: CompanyDocumentRow) => void | Promise<void>;
  /** Koš — bez úprav a mazání. */
  readOnlyTrash?: boolean;
  /** Skrýt ikonu koše (např. pro nepřihlášené role). */
  showDeleteButton?: boolean;
  paymentFilter: string;
  onPaymentFilterChange: (v: string) => void;
  /** Unikátní prefix pro id řádku (scroll z souhrnu „po splatnosti“). */
  flashDomScope: string;
  paymentFlashRowKey?: string | null;
}) {
  const [jobFilter, setJobFilter] = useState<string>("__all__");
  const [jobAssignmentFilter, setJobAssignmentFilter] = useState<
    "all" | "assigned" | "unassigned"
  >("all");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("__all__");
  const [typeFilter, setTypeFilter] = useState<string>("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const jobOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of data) {
      for (const jid of documentLinkedJobIds(d)) {
        m.set(
          jid,
          jobNamesById.get(jid) ||
            d.jobName?.trim() ||
            d.entityName?.trim() ||
            jid
        );
      }
      const primary = documentJobLinkId(d);
      if (primary) {
        m.set(
          primary,
          d.jobName?.trim() || d.entityName?.trim() || primary
        );
      }
    }
    return [...m.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], "cs", { sensitivity: "base" })
    );
  }, [data, jobNamesById]);

  const rows = useMemo(() => {
    let list = [...data];
    if (jobAssignmentFilter === "assigned") {
      list = list.filter((d) => companyDocumentMatchesAssignedJobFilter(d));
    } else if (jobAssignmentFilter === "unassigned") {
      list = list.filter((d) => companyDocumentMatchesUnassignedJobFilter(d));
    }
    if (jobFilter !== "__all__") {
      list = list.filter((d) =>
        companyDocumentMatchesJobFilterRow(d, jobFilter)
      );
    }
    if (docTypeFilter !== "__all__") {
      list = list.filter((d) => {
        if (docTypeFilter === "delivery_note") return isDeliveryNote(d);
        if (docTypeFilter === "document") return !isDeliveryNote(d);
        return true;
      });
    }
    if (typeFilter !== "__all__") {
      list = list.filter((d) => {
        const k = inferDocRowFileKind(d);
        if (typeFilter === "none") return k === "none";
        return k === typeFilter;
      });
    }
    const df = dateFrom.trim();
    const dt = dateTo.trim();
    if (df) list = list.filter((d) => (d.date || "") >= df);
    if (dt) list = list.filter((d) => (d.date || "") <= dt);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const allocNames = documentLinkedJobIds(d)
          .map((jid) => jobNamesById.get(jid) ?? "")
          .join(" ");
        const hay = [
          d.number,
          d.entityName,
          d.nazev,
          d.description,
          d.note ?? "",
          d.poznamka ?? "",
          d.jobName ?? "",
          allocNames,
          d.sourceLabel ?? "",
          d.fileName ?? "",
          d.mimeType ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    if (paymentFilter !== "__all__") {
      list = list.filter((d) => {
        const pr = d as CompanyDocumentPaymentRow;
        const u = getDocumentPaymentUrgency(pr, todayIso);
        if (paymentFilter === "to_pay") {
          return isDocumentEligibleForPaymentBox(pr);
        }
        if (paymentFilter === "needs_flag") return pr.requiresPayment === true;
        if (paymentFilter === "paid") return pr.paid === true;
        if (paymentFilter === "unpaid") return pr.paid !== true;
        if (paymentFilter === "overdue") return u === "overdue";
        if (paymentFilter === "due_soon") return u === "due_soon";
        return true;
      });
    }
    list.sort((a, b) => {
      const ea = isDocumentEligibleForPaymentBox(a as CompanyDocumentPaymentRow);
      const eb = isDocumentEligibleForPaymentBox(b as CompanyDocumentPaymentRow);
      if (ea && eb) {
        return compareDocumentsForPaymentQueue(
          a as CompanyDocumentPaymentRow,
          b as CompanyDocumentPaymentRow,
          todayIso
        );
      }
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      return docCreatedAtMs(b.createdAt) - docCreatedAtMs(a.createdAt);
    });
    return list;
  }, [
    data,
    jobFilter,
    jobAssignmentFilter,
    docTypeFilter,
    typeFilter,
    paymentFilter,
    dateFrom,
    dateTo,
    search,
    todayIso,
    jobNamesById,
  ]);

  const fileKindLabel = (k: JobMediaFileType | "none") => {
    if (k === "pdf") return "PDF";
    if (k === "office") return "Office";
    if (k === "image") return "Obrázek";
    return "—";
  };

  /**
   * Mobil: jeden sloupec → žádné překrývání sloupců; desktop: původní kompaktní mřížka.
   */
  const receivedRowGrid = cn(
    "grid w-full items-start [&>*]:min-w-0 break-words",
    "grid-cols-1 gap-3 px-3 py-3 text-[13px] leading-relaxed sm:text-xs sm:px-2 sm:py-2 sm:gap-2",
    "lg:grid-cols-[92px_minmax(0,1.35fr)_30px_minmax(0,0.95fr)_62px_minmax(0,1.15fr)_minmax(72px,0.9fr)_minmax(0,1fr)] lg:gap-x-1.5 lg:gap-y-0.5 lg:text-[11px] lg:leading-snug"
  );

  return (
    <Card className="min-w-0 overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-gray-200 bg-white p-2 sm:p-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Hledat (název, zakázka, poznámka…)"
            className="h-9 border-gray-300 bg-white pl-8 text-sm text-gray-900"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6 lg:gap-x-3">
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">
              Zařazení dokladu
            </Label>
            <Select
              value={jobAssignmentFilter}
              onValueChange={(v) =>
                setJobAssignmentFilter(v as "all" | "assigned" | "unassigned")
              }
            >
              <SelectTrigger
                className={cn(
                  "h-9 w-full border-gray-300 bg-white text-gray-900",
                  jobAssignmentFilter !== "all" &&
                    "border-primary/60 ring-1 ring-primary/25"
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny doklady</SelectItem>
                <SelectItem value="assigned">Zařazené</SelectItem>
                <SelectItem value="unassigned">Nezařazené doklady</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Zakázka</Label>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
                <SelectValue placeholder="Všechny zakázky" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny zakázky</SelectItem>
                {jobOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    <span className="truncate">{name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Kategorie</Label>
            <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny</SelectItem>
                <SelectItem value="document">Doklady</SelectItem>
                <SelectItem value="delivery_note">Dodací listy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-[11px] font-medium text-gray-800">Typ souboru</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-full border-gray-300 bg-white text-gray-900">
                <SelectValue placeholder="Všechny typy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny typy</SelectItem>
                <SelectItem value="image">Obrázek</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="office">Office</SelectItem>
                <SelectItem value="none">Bez přílohy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-gray-800">Od data</Label>
            <Input
              type="date"
              className="h-9 border-gray-300 bg-white text-gray-900"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-gray-800">Do data</Label>
            <Input
              type="date"
              className="h-9 border-gray-300 bg-white text-gray-900"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1 min-w-0 sm:col-span-2 lg:col-span-6">
            <Label className="text-[11px] font-medium text-gray-800">Platba / splatnost</Label>
            <Select value={paymentFilter} onValueChange={onPaymentFilterChange}>
              <SelectTrigger
                className={cn(
                  "h-9 w-full border-gray-300 bg-white text-gray-900",
                  paymentFilter !== "__all__" &&
                    "border-primary/60 ring-1 ring-primary/25"
                )}
              >
                <SelectValue placeholder="Vše" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny doklady</SelectItem>
                <SelectItem value="to_pay">K úhradě (nezaplacené)</SelectItem>
                <SelectItem value="needs_flag">Označené k úhradě</SelectItem>
                <SelectItem value="unpaid">Nezaplacené</SelectItem>
                <SelectItem value="paid">Zaplacené</SelectItem>
                <SelectItem value="overdue">Po splatnosti</SelectItem>
                <SelectItem value="due_soon">Blíží se splatnost</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : rows.length > 0 ? (
          <div className="w-full overflow-hidden bg-white">
            <div
              className={cn(
                receivedRowGrid,
                "hidden border-b border-gray-200 bg-gray-100 font-semibold text-gray-900 lg:grid"
              )}
            >
              <span className="text-left">Akce</span>
              <span>Doklad</span>
              <span className="text-center lg:text-center">Typ</span>
              <span>Zakázka</span>
              <span>Datum</span>
              <span>Úhrada / splatnost / stav</span>
              <span className="text-left tabular-nums lg:text-right">Částka</span>
              <span>Poznámka</span>
            </div>
            {rows.map((row) => {
              const jobLinkId = documentJobLinkId(row);
              const linkedJobIds = documentLinkedJobIds(row);
              const briefcaseJobId = linkedJobIds[0] || jobLinkId;
              const showPendingHighlight = documentShowsAsPendingAssignment(row);
              const fromJobExpense =
                row.source === JOB_EXPENSE_DOCUMENT_SOURCE ||
                row.sourceType === "expense";
              const fromJobMedia =
                row.source === JOB_MEDIA_DOCUMENT_SOURCE ||
                row.sourceType === "job";
              const fk = inferDocRowFileKind(row);
              const RowIcon = fk === "image" ? ImageIcon : FileText;

              const amts = docDisplayAmounts(row);
              const showAmount =
                !fromJobMedia &&
                (amts.amountGross > 0 || amts.amountNet > 0);
              const title = docDisplayTitle(row);
              const canEditRow = !fromJobMedia && !readOnlyTrash;
              const pr = row as CompanyDocumentPaymentRow;
              const payU = getDocumentPaymentUrgency(pr, todayIso);
              const payHighlightClasses = getDocumentStatusStyle(pr);

              const assignmentBadge = resolveDocumentAssignmentBadge(row);

              const iconBtn =
                "h-10 w-10 shrink-0 p-0 text-gray-700 hover:bg-gray-100 hover:text-gray-950 sm:h-7 sm:w-7 touch-manipulation";

              const flashThisRow =
                paymentFlashRowKey === `doc:${row.id}` && paymentFlashRowKey !== null;

              return (
                <Fragment key={row.id}>
                <div
                  id={`payment-flash-${flashDomScope}-doc-${row.id}`}
                  className={cn(
                    receivedRowGrid,
                    "border-b border-gray-200 max-lg:rounded-lg max-lg:border",
                    payHighlightClasses ||
                      "text-gray-900 hover:bg-gray-50/80 max-lg:border-gray-200 max-lg:bg-white",
                    !payHighlightClasses &&
                      fromJobExpense &&
                      "bg-amber-50/90",
                    !payHighlightClasses && fromJobMedia && "bg-sky-50/90",
                    showPendingHighlight &&
                      "ring-1 ring-inset ring-amber-200",
                    flashThisRow &&
                      "z-[1] ring-2 ring-amber-500 shadow-md transition-shadow duration-300"
                  )}
                >
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Akce
                    </span>
                    {!readOnlyTrash && isDocumentEligibleForPaymentBox(pr) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10 px-2 text-[11px] font-medium leading-none sm:h-6 sm:min-h-0 sm:px-1 sm:text-[9px] touch-manipulation"
                        title="Označit jako zaplaceno"
                        onClick={() => void onMarkPaid(row)}
                      >
                        Zapl.
                      </Button>
                    ) : null}
                    {!readOnlyTrash &&
                    resolveCompanyDocumentPaymentStatus(pr) === "paid" &&
                    row.requiresPayment ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-10 px-2 text-[11px] leading-none sm:h-6 sm:min-h-0 sm:px-1 sm:text-[9px] touch-manipulation"
                        title="Označit jako nezaplaceno"
                        onClick={() => void onMarkUnpaid(row)}
                      >
                        Nezap.
                      </Button>
                    ) : null}
                    {row.fileUrl ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={iconBtn}
                        asChild
                        title="Příloha"
                      >
                        <a
                          href={row.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {briefcaseJobId ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={iconBtn}
                        asChild
                        title="Zakázka"
                      >
                        <Link href={`/portal/jobs/${briefcaseJobId}`}>
                          <Briefcase className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    {canEditRow ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Upravit"
                        onClick={() => onEdit(row)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {canEditRow && isDeliveryNote(row) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Přiřadit k faktuře"
                        onClick={() => onEdit(row)}
                      >
                        <ReceiptText className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {!readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={iconBtn}
                        title="Přiřadit"
                        onClick={() => onAssign(row)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {showDeleteButton && !readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(iconBtn, "hover:text-red-700")}
                        title="Smazat"
                        onClick={() => onDelete(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Doklad
                    </span>
                    <div className="flex items-start gap-1">
                      <RowIcon
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          fk === "pdf" && "text-red-600",
                          fk === "office" && "text-blue-700",
                          fk === "image" && "text-emerald-600",
                          fk === "none" && "text-gray-400"
                        )}
                      />
                      <span
                        className="font-medium text-gray-950 line-clamp-2 break-words"
                        title={title}
                      >
                        {title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      <Badge
                        variant="secondary"
                        className="h-5 border-gray-300 px-1.5 text-[10px] font-normal text-gray-900"
                      >
                        {isDeliveryNote(row) ? "Dodací list" : "Přijaté"}
                      </Badge>
                      {readOnlyTrash ? (
                        <Badge className="h-5 bg-red-700 px-1.5 text-[10px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                      {fromJobExpense ? (
                        <Badge className="h-5 bg-amber-600 px-1.5 text-[10px] font-normal hover:bg-amber-600">
                          Náklad Z
                        </Badge>
                      ) : null}
                      {fromJobMedia ? (
                        <Badge className="h-5 bg-sky-700 px-1.5 text-[10px] text-white hover:bg-sky-700">
                          Média
                        </Badge>
                      ) : null}
                      <Badge
                        className={cn(
                          "h-5 px-1.5 text-[10px] font-normal text-white",
                          showPendingHighlight
                            ? "bg-amber-600 hover:bg-amber-600"
                            : "bg-slate-700 hover:bg-slate-700"
                        )}
                      >
                        {assignmentBadge}
                      </Badge>
                      {isDeliveryNote(row) ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {row.invoiceId ? "Faktura přiřazena" : "Není přiřazeno k faktuře"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-left text-gray-800 lg:text-center">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Typ souboru
                    </span>
                    {fileKindLabel(fk)}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Zakázka
                    </span>
                    <ReceivedDocJobColumnCell
                      row={row}
                      jobNamesById={jobNamesById}
                      showPendingHighlight={showPendingHighlight}
                    />
                  </div>

                  <div className="whitespace-normal text-gray-900 lg:whitespace-nowrap">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Datum
                    </span>
                    {row.date ?? "—"}
                  </div>

                  <div className="space-y-0.5 text-gray-900">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Úhrada / stav
                    </span>
                    <div className="flex flex-wrap gap-x-1 gap-y-0">
                      <span>{row.requiresPayment ? "K úhr.: ano" : "K úhr.: ne"}</span>
                      <span className="text-gray-800">·</span>
                      <span className="tabular-nums">
                        {row.dueDate?.trim() || "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <Badge
                        className={cn(
                          "h-5 px-1.5 text-[10px]",
                          paymentStatusBadgeClass(
                            resolveCompanyDocumentPaymentStatus(pr)
                          )
                        )}
                      >
                        {paymentStatusLabel(
                          resolveCompanyDocumentPaymentStatus(pr)
                        )}
                      </Badge>
                      {!row.requiresPayment ||
                      resolveCompanyDocumentPaymentStatus(pr) === "paid" ? null : (
                        <Badge
                          className={cn(
                            "h-5 px-1.5 text-[10px]",
                            payU === "overdue" &&
                              "border-red-700 bg-red-100 text-red-950",
                            payU === "due_soon" &&
                              "border-amber-600 bg-amber-100 text-amber-950",
                            payU === "incomplete_no_due" &&
                              "border-amber-700 bg-yellow-50 text-yellow-950",
                            payU === "ok" &&
                              "border-gray-400 bg-gray-100 text-gray-900"
                          )}
                        >
                          {urgencyLabel(payU)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-left tabular-nums text-gray-950 lg:text-right">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Částka
                    </span>
                    {showAmount ? (
                      <div className="space-y-0">
                        <div className="text-[10px] font-medium uppercase text-gray-700">
                          {docVatInfoLine(row)}
                        </div>
                        {inferSDPH(row) ? (
                          <>
                            <div className="text-gray-800">
                              Základ{" "}
                              {formatDocMoney(amts.amountNet, amts.currency)}
                            </div>
                            <div className="text-[10px] text-gray-800">
                              DPH {formatDocMoney(amts.vatAmount, amts.currency)}
                            </div>
                            <div className="font-semibold text-gray-950">
                              {formatDocMoney(amts.amountGross, amts.currency)}
                            </div>
                            {amts.showCzkHint ? (
                              <div className="text-[10px] text-gray-600">
                                (≈ {amts.amountGrossCZK.toLocaleString("cs-CZ")}{" "}
                                Kč)
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-gray-950">
                              {formatDocMoney(amts.amountGross, amts.currency)}
                            </div>
                            {amts.showCzkHint ? (
                              <div className="text-[10px] text-gray-600">
                                (≈ {amts.amountGrossCZK.toLocaleString("cs-CZ")}{" "}
                                Kč)
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Poznámka
                    </span>
                    <p className="line-clamp-3 break-words text-gray-900 lg:line-clamp-2">
                      {row.note || row.description || "—"}
                    </p>
                  </div>
                </div>
                <DocumentCostAllocationDetail
                  row={row}
                  jobNamesById={jobNamesById}
                />
                </Fragment>
              );
            })}
          </div>
        ) : data.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné přijaté doklady.
          </div>
        ) : jobAssignmentFilter === "unassigned" ? (
          <div className="text-center py-20 text-muted-foreground">
            Žádné nezařazené doklady.
          </div>
        ) : jobAssignmentFilter === "assigned" ? (
          <div className="text-center py-20 text-muted-foreground">
            Žádné doklady neodpovídají filtru „Zařazené“ nebo hledání.
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Žádný doklad neodpovídá filtru nebo hledání.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentTableIssued({
  data,
  invoices = [],
  isLoadingInvoices = false,
  jobs,
  isLoading,
  onDelete,
  onDeleteInvoice,
  onEdit,
  onAssign,
  search,
  onSearchChange,
  onMarkPaid: _onMarkPaid,
  onMarkUnpaid: _onMarkUnpaid,
  readOnlyTrash = false,
  showDeleteButton = true,
  todayIso,
  paymentFilter,
  onPaymentFilterChange,
  flashDomScope,
  paymentFlashRowKey = null,
}: {
  data: CompanyDocumentRow[];
  invoices?: Array<Record<string, unknown> & { id: string }>;
  isLoadingInvoices?: boolean;
  jobs: Array<{ id: string; name: string }>;
  isLoading: boolean;
  onDelete: (row: CompanyDocumentRow) => void;
  onDeleteInvoice: (inv: Record<string, unknown> & { id: string }) => void;
  onEdit: (row: CompanyDocumentRow) => void;
  onAssign: (row: CompanyDocumentRow) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onMarkPaid?: (row: CompanyDocumentRow) => void | Promise<void>;
  onMarkUnpaid?: (row: CompanyDocumentRow) => void | Promise<void>;
  readOnlyTrash?: boolean;
  showDeleteButton?: boolean;
  todayIso: string;
  paymentFilter: string;
  onPaymentFilterChange: (v: string) => void;
  flashDomScope: string;
  paymentFlashRowKey?: string | null;
}) {
  const { toast } = useToast();
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const issuedRow = cn(
    "grid w-full items-start border-b border-gray-200 [&>*]:min-w-0 break-words",
    "grid-cols-1 gap-3 px-3 py-3 text-[13px] leading-relaxed sm:text-xs sm:px-2 sm:py-2 sm:gap-2",
    "lg:grid-cols-[88px_minmax(0,1.2fr)_minmax(0,1fr)_72px_minmax(0,1fr)] lg:gap-x-1.5 lg:gap-y-0.5 lg:text-[11px] lg:leading-snug"
  );

  const merged = useMemo(() => {
    type E =
      | { kind: "doc"; row: CompanyDocumentRow; sortKey: string }
      | {
          kind: "inv";
          inv: Record<string, unknown> & { id: string };
          sortKey: string;
        };
    const out: E[] = [];
    for (const row of data) {
      if (categoryFilter === "invoices") {
        continue;
      }
      if (categoryFilter === "delivery_notes" && !isDeliveryNote(row)) continue;
      if (categoryFilter === "documents" && isDeliveryNote(row)) continue;
      out.push({
        kind: "doc",
        row,
        sortKey: String(row.date ?? ""),
      });
    }
    for (const inv of invoices) {
      if (categoryFilter !== "__all__" && categoryFilter !== "invoices") continue;
      out.push({
        kind: "inv",
        inv,
        sortKey: String(inv.issueDate ?? inv.date ?? ""),
      });
    }
    out.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return out;
  }, [data, invoices, categoryFilter]);

  const mergedShown = useMemo(
    () =>
      merged.filter((entry) =>
        issuedMergedEntryMatchesPaymentFilter(entry, paymentFilter, todayIso)
      ),
    [merged, paymentFilter, todayIso]
  );

  const jobNameForId = (jid: string) =>
    jobs.find((j) => j.id === jid)?.name ?? null;

  const invoiceStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="h-5 bg-emerald-700 px-1.5 text-[10px] text-white">Zaplaceno</Badge>;
      case "partially_paid":
        return <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Částečně</Badge>;
      case "unpaid":
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Neuhrazeno</Badge>;
      case "sent":
        return <Badge className="h-5 bg-blue-600 px-1.5 text-[10px] text-white">Odesláno</Badge>;
      case "draft":
        return <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Koncept</Badge>;
      default:
        return (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {status || "—"}
          </Badge>
        );
    }
  };

  const loading = isLoading || isLoadingInvoices;

  return (
    <Card className="min-w-0 overflow-hidden border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between gap-2 border-b border-gray-200 p-2 sm:flex-row sm:items-center sm:p-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Hledat ve vydaných (doklady i faktury)…"
            className="h-9 border-gray-300 bg-white pl-8 text-sm text-gray-900"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-[180px] border-gray-300 bg-white text-xs text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Všechny</SelectItem>
              <SelectItem value="invoices">Faktury</SelectItem>
              <SelectItem value="documents">Doklady</SelectItem>
              <SelectItem value="delivery_notes">Dodací listy</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex min-w-[min(100%,220px)] flex-col gap-0.5">
            <span className="text-[10px] font-medium text-gray-600">
              Platba / splatnost
            </span>
            <Select value={paymentFilter} onValueChange={onPaymentFilterChange}>
              <SelectTrigger
                className={cn(
                  "h-8 border-gray-300 bg-white text-xs text-gray-900",
                  paymentFilter !== "__all__" &&
                    "border-primary/60 ring-1 ring-primary/25"
                )}
              >
                <SelectValue placeholder="Vše" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Všechny položky</SelectItem>
                <SelectItem value="to_pay">K úhradě (nezaplacené)</SelectItem>
                <SelectItem value="needs_flag">Označené k úhradě</SelectItem>
                <SelectItem value="unpaid">Nezaplacené</SelectItem>
                <SelectItem value="paid">Zaplacené</SelectItem>
                <SelectItem value="overdue">Po splatnosti</SelectItem>
                <SelectItem value="due_soon">Blíží se splatnost</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!readOnlyTrash ? (
            <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs" asChild>
              <Link href="/portal/invoices/new">
                <ReceiptText className="h-3.5 w-3.5 shrink-0" /> Nová faktura
              </Link>
            </Button>
          ) : null}
          <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <Filter className="h-3.5 w-3.5 shrink-0" /> Filtr
          </Button>
          <Button variant="outlineLight" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <Download className="h-3.5 w-3.5 shrink-0" /> Export
          </Button>
        </div>
      </div>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : mergedShown.length > 0 ? (
          <div className="w-full overflow-hidden bg-white">
            <div
              className={cn(
                issuedRow,
                "hidden border-b border-gray-200 bg-gray-100 font-semibold text-gray-900 lg:grid"
              )}
            >
              <span>Akce</span>
              <span>Doklad</span>
              <span>Zakázka</span>
              <span>Datum / splatnost</span>
              <span className="text-left tabular-nums lg:text-right">Částka</span>
            </div>
            {mergedShown.map((entry) => {
              const ib =
                "h-10 w-10 shrink-0 p-0 text-gray-700 hover:bg-gray-100 hover:text-gray-950 sm:h-7 sm:w-7 touch-manipulation";
              if (entry.kind === "doc") {
                const docRow = entry.row;
                const issuedAm = docDisplayAmounts(docRow);
                const title = docDisplayTitle(docRow);
                const issuedJobId = documentJobLinkId(docRow);
                const issuedPr = docRow as CompanyDocumentPaymentRow;
                const issuedHlCls = getDocumentStatusStyle(issuedPr);
                const flashIssuedDoc =
                  paymentFlashRowKey === `doc:${docRow.id}` &&
                  paymentFlashRowKey !== null;
                return (
                  <div
                    key={`doc-${docRow.id}`}
                    id={`payment-flash-${flashDomScope}-doc-${docRow.id}`}
                    className={cn(
                      issuedRow,
                      "max-lg:rounded-lg max-lg:border",
                      issuedHlCls ||
                        "text-gray-900 hover:bg-gray-50/80 max-lg:border-gray-200 max-lg:bg-white",
                      flashIssuedDoc &&
                        "z-[1] ring-2 ring-amber-500 shadow-md transition-shadow duration-300"
                    )}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Akce
                      </span>
                      {issuedJobId ? (
                        <Button
                          variant="outline"
                          size="icon"
                          className={ib}
                          asChild
                          title="Zakázka"
                        >
                          <Link href={`/portal/jobs/${issuedJobId}`}>
                            <Briefcase className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : null}
                      {!readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={ib}
                          title="Upravit"
                          onClick={() => onEdit(docRow)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {!readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={ib}
                          title="Přiřadit k zakázce"
                          onClick={() => onAssign(docRow)}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      {showDeleteButton && !readOnlyTrash ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(docRow)}
                          className={cn(ib, "hover:text-red-700")}
                          aria-label="Smazat doklad"
                          title="Smazat"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="min-w-0 font-medium">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Doklad
                      </span>
                      <Badge variant="outline" className="mb-0.5 h-5 px-1 text-[9px]">
                        {isDeliveryNote(docRow) ? "Dodací list" : "Vydaný doklad"}
                      </Badge>
                      {readOnlyTrash ? (
                        <Badge className="mb-0.5 ml-1 h-5 bg-red-700 px-1 text-[9px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                      <div className="flex items-start gap-1">
                        <FileDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                        <span
                          className="line-clamp-2 break-words text-gray-950"
                          title={title}
                        >
                          {title}
                        </span>
                      </div>
                      {docRow.number?.trim() && docRow.number !== title ? (
                        <span className="mt-0.5 block pl-4 text-[10px] text-gray-700 line-clamp-1">
                          {docRow.number}
                        </span>
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Zakázka
                      </span>
                      {issuedJobId ? (
                        <Link
                          href={`/portal/jobs/${issuedJobId}`}
                          className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
                          title={docRow.jobName ?? ""}
                        >
                          {docRow.jobName ?? "Zakázka"}
                        </Link>
                      ) : (
                        <span className="text-gray-800">
                          {docRow.assignmentType === "warehouse"
                            ? "Sklad"
                            : docRow.assignmentType === "company" ||
                                docRow.assignmentType === "overhead"
                              ? "Firma"
                              : "Doklad není zařazen"}
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5 whitespace-normal text-gray-900 lg:whitespace-nowrap">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Datum / splatnost
                      </span>
                      <div>{docRow.date ?? "—"}</div>
                      {docRow.dueDate ? (
                        <div className="text-[10px] text-gray-600">
                          spl. {docRow.dueDate}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-left tabular-nums text-gray-950 lg:text-right">
                      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                        Částka
                      </span>
                      <div className="text-[10px] font-medium uppercase text-gray-700">
                        {docVatInfoLine(docRow)}
                      </div>
                      {inferSDPH(docRow) ? (
                        <>
                          <div className="text-gray-800">
                            Základ{" "}
                            {formatDocMoney(issuedAm.amountNet, issuedAm.currency)}
                          </div>
                          <div className="text-[10px] text-gray-800">
                            DPH{" "}
                            {formatDocMoney(issuedAm.vatAmount, issuedAm.currency)}
                          </div>
                          <div className="font-semibold text-gray-950">
                            {formatDocMoney(
                              issuedAm.amountGross,
                              issuedAm.currency
                            )}
                          </div>
                          {issuedAm.showCzkHint ? (
                            <div className="text-[10px] text-gray-600">
                              (≈{" "}
                              {issuedAm.amountGrossCZK.toLocaleString("cs-CZ")} Kč)
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-gray-950">
                            {formatDocMoney(
                              issuedAm.amountGross,
                              issuedAm.currency
                            )}
                          </div>
                          {issuedAm.showCzkHint ? (
                            <div className="text-[10px] text-gray-600">
                              (≈{" "}
                              {issuedAm.amountGrossCZK.toLocaleString("cs-CZ")} Kč)
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                );
              }
              const inv = entry.inv;
              const jid = String(inv.jobId ?? "").trim();
              const gross = roundMoney2(
                Number(inv.amountGross ?? inv.totalAmount ?? 0)
              );
              const net = roundMoney2(Number(inv.amountNet ?? 0));
              const vat = roundMoney2(Number(inv.vatAmount ?? 0));
              const invTitle =
                String(inv.invoiceNumber ?? inv.documentNumber ?? inv.id) ||
                "Faktura";
              const cust = String(inv.customerName ?? "").trim() || "—";
              const invHlCls = getInvoiceDocumentStatusStyle(inv);
              const flashIssuedInv =
                paymentFlashRowKey === `inv:${inv.id}` &&
                paymentFlashRowKey !== null;
              return (
                <div
                  key={`inv-${inv.id}`}
                  id={`payment-flash-${flashDomScope}-inv-${inv.id}`}
                  className={cn(
                    issuedRow,
                    "max-lg:rounded-lg max-lg:border",
                    invHlCls ||
                      "text-gray-900 hover:bg-gray-50/80 max-lg:border-emerald-200 max-lg:bg-emerald-50/40 lg:border-l-2 lg:border-l-emerald-500/80",
                    flashIssuedInv &&
                      "z-[1] ring-2 ring-amber-500 shadow-md transition-shadow duration-300"
                  )}
                >
                  <div className="flex flex-wrap gap-1.5">
                    <span className="w-full text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Akce
                    </span>
                    {jid ? (
                      <Button
                        variant="outline"
                        size="icon"
                        className={ib}
                        asChild
                        title="Zakázka"
                      >
                        <Link href={`/portal/jobs/${jid}`}>
                          <Briefcase className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="icon" className={ib} asChild title="Detail faktury">
                      <Link href={`/portal/invoices/${inv.id}`}>
                        <ReceiptText className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    {!readOnlyTrash ? (
                      <Button variant="ghost" size="icon" className={ib} asChild title="Upravit">
                        <Link href={`/portal/invoices/${inv.id}/edit`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={ib}
                      title="Tisk / PDF"
                      onClick={() => openInvoicePrintFromRow(inv, toast)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    {showDeleteButton && !readOnlyTrash ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(ib, "hover:text-red-700")}
                        title="Smazat fakturu"
                        aria-label="Smazat fakturu"
                        onClick={() => onDeleteInvoice(inv)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="min-w-0 font-medium">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Doklad
                    </span>
                    <div className="mb-0.5 flex flex-wrap items-center gap-1">
                      <Badge className="h-5 bg-emerald-700/90 px-1 text-[9px] text-white">
                        {invoiceDocTypeLabel(inv)}
                      </Badge>
                      {invoiceStatusBadge(String(inv.status ?? ""))}
                      {readOnlyTrash ? (
                        <Badge className="h-5 bg-red-700 px-1 text-[9px] text-white hover:bg-red-700">
                          Smazáno
                        </Badge>
                      ) : null}
                    </div>
                    <span
                      className="line-clamp-2 break-words text-gray-950"
                      title={invTitle}
                    >
                      {invTitle}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-gray-700 line-clamp-2 break-words">
                      {cust}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Zakázka
                    </span>
                    {jid ? (
                      <Link
                        href={`/portal/jobs/${jid}`}
                        className="font-medium text-blue-800 underline-offset-2 hover:underline line-clamp-2 break-words"
                      >
                        {jobNameForId(jid) ?? "Zakázka"}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </div>
                  <div className="space-y-0.5 whitespace-normal text-gray-900 lg:whitespace-nowrap">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Datum / splatnost
                    </span>
                    <div>{String(inv.issueDate ?? "—")}</div>
                    {inv.dueDate ? (
                      <div className="text-[10px] text-amber-800">
                        spl. {String(inv.dueDate)}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-left tabular-nums text-gray-950 lg:text-right">
                    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500 lg:hidden">
                      Částka
                    </span>
                    <div className="text-[10px] font-medium uppercase text-gray-700">
                      s DPH
                    </div>
                    <div className="text-gray-800">
                      Základ {net.toLocaleString("cs-CZ")} Kč
                    </div>
                    <div className="text-[10px] text-gray-800">
                      DPH {vat.toLocaleString("cs-CZ")} Kč
                    </div>
                    <div className="font-semibold text-gray-950">
                      {gross.toLocaleString("cs-CZ")} Kč
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : merged.length > 0 && mergedShown.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            Žádná položka neodpovídá filtru platby / splatnosti (zkuste jiný filtr nebo{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => onPaymentFilterChange("__all__")}
            >
              zrušit filtr
            </button>
            ).
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground">
            Zatím nemáte žádné vydané doklady ani faktury.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <DocumentsPageContent />
    </Suspense>
  );
}
