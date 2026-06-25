/**
 * Rozpracovaný dialog „Nový obchodní doklad“ — přežije remount stránky (Suspense / návrat na kartu).
 * Soubor (File) nelze serializovat; ukládá se jen název pro nápovědu.
 */

const STORAGE_KEY = "rajmon:documents-add-dialog-draft:v1";

type DocumentCostCategoryKey = "material" | "work" | "transport" | "other";

export type DocumentsAddDialogDraft = {
  open: boolean;
  newDocKind: "document" | "delivery_note";
  newDocType: "received" | "issued";
  assignmentType:
    | "pending_assignment"
    | "job_cost"
    | "company"
    | "warehouse"
    | "overhead";
  selectedJobId: string;
  selectedInvoiceId: string;
  selectedWarehouseId: string;
  pendingFileName: string | null;
  formData: {
    number: string;
    entityName: string;
    amount: string;
    currency: "CZK" | "EUR";
    vat: string;
    date: string;
    description: string;
    costCategory: DocumentCostCategoryKey;
    requiresPayment: boolean;
    dueDate: string;
    paymentStatus: "unpaid" | "partial" | "paid";
    paidAmount: string;
    paidAt: string;
    paymentMethod: "cash" | "bank" | "card" | "other";
    paymentNote: string;
  };
};

export function readDocumentsAddDialogDraft(): DocumentsAddDialogDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const d = parsed as Partial<DocumentsAddDialogDraft>;
    if (d.open !== true || !d.formData || typeof d.formData !== "object") return null;
    return {
      open: true,
      newDocKind: d.newDocKind === "delivery_note" ? "delivery_note" : "document",
      newDocType: d.newDocType === "issued" ? "issued" : "received",
      assignmentType:
        d.assignmentType === "job_cost" ||
        d.assignmentType === "warehouse" ||
        d.assignmentType === "company" ||
        d.assignmentType === "overhead"
          ? d.assignmentType
          : "pending_assignment",
      selectedJobId: String(d.selectedJobId ?? ""),
      selectedInvoiceId: String(d.selectedInvoiceId ?? ""),
      selectedWarehouseId: String(d.selectedWarehouseId ?? ""),
      pendingFileName:
        typeof d.pendingFileName === "string" && d.pendingFileName.trim()
          ? d.pendingFileName.trim()
          : null,
      formData: {
        number: String(d.formData.number ?? ""),
        entityName: String(d.formData.entityName ?? ""),
        amount: String(d.formData.amount ?? ""),
        currency: d.formData.currency === "EUR" ? "EUR" : "CZK",
        vat: String(d.formData.vat ?? "21"),
        date: String(d.formData.date ?? new Date().toISOString().split("T")[0]),
        description: String(d.formData.description ?? ""),
        costCategory: (d.formData.costCategory as DocumentCostCategoryKey) ?? "other",
        requiresPayment: d.formData.requiresPayment === true,
        dueDate: String(d.formData.dueDate ?? ""),
        paymentStatus:
          d.formData.paymentStatus === "partial" || d.formData.paymentStatus === "paid"
            ? d.formData.paymentStatus
            : "unpaid",
        paidAmount: String(d.formData.paidAmount ?? ""),
        paidAt: String(d.formData.paidAt ?? ""),
        paymentMethod:
          d.formData.paymentMethod === "cash" ||
          d.formData.paymentMethod === "card" ||
          d.formData.paymentMethod === "other"
            ? d.formData.paymentMethod
            : "bank",
        paymentNote: String(d.formData.paymentNote ?? ""),
      },
    };
  } catch {
    return null;
  }
}

export function writeDocumentsAddDialogDraft(draft: DocumentsAddDialogDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota */
  }
}

export function clearDocumentsAddDialogDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function defaultDocumentsAddFormData(): DocumentsAddDialogDraft["formData"] {
  return {
    number: "",
    entityName: "",
    amount: "",
    currency: "CZK",
    vat: "21",
    date: new Date().toISOString().split("T")[0],
    description: "",
    costCategory: "other",
    requiresPayment: false,
    dueDate: "",
    paymentStatus: "unpaid",
    paidAmount: "",
    paidAt: "",
    paymentMethod: "bank",
    paymentNote: "",
  };
}
