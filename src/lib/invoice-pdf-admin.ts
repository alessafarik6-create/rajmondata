import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";
import type { OrgBankAccountRow } from "@/lib/invoice-billing-meta";
import {
  INVOICE_PDF_FIELD_ARCHIVE,
  INVOICE_PDF_FIELD_ARCHIVE_AT,
  INVOICE_PDF_FIELD_PREVIEW,
  INVOICE_PDF_FIELD_PREVIEW_VERSION,
  INVOICE_PDF_TEMPLATE_VERSION,
  isInvoicePdfTemplateOutdated,
} from "@/lib/invoice-pdf-template";
import {
  rebuildInvoiceHtmlFromDocument,
  resolveInvoiceDisplayHtml,
} from "@/lib/invoice-html-rebuild";
import { JOB_INVOICE_TYPES } from "@/lib/job-billing-invoices";

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

export async function loadOrgBankAccountsAdmin(
  db: Firestore,
  companyId: string
): Promise<OrgBankAccountRow[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("bankAccounts")
    .get();
  return snap.docs.map((d) => {
    const row = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      name: trim(row.name) || null,
      accountNumber: trim(row.accountNumber) || null,
      bankCode: trim(row.bankCode) || null,
      iban: trim(row.iban) || null,
      swift: trim(row.swift) || null,
      isDefault: row.isDefault === true,
    };
  });
}

async function relatedAdvanceNumber(
  db: Firestore,
  companyId: string,
  doc: Record<string, unknown>
): Promise<string | null> {
  const relatedId = trim(doc.relatedInvoiceId);
  if (!relatedId) return null;
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("invoices")
    .doc(relatedId)
    .get();
  if (!snap.exists) return null;
  const adv = snap.data() as { invoiceNumber?: string };
  return trim(adv.invoiceNumber) || null;
}

export async function buildInvoicePreviewHtmlAdmin(
  db: Firestore,
  companyId: string,
  invoiceId: string
): Promise<
  | {
      ok: true;
      html: string;
      source: string;
      templateVersion: number;
      hasOriginalArchive: boolean;
      outdated: boolean;
    }
  | { ok: false; error: string }
> {
  const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(invoiceId);
  const snap = await iref.get();
  if (!snap.exists) return { ok: false, error: "Doklad nenalezen." };
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (!isActiveFirestoreDoc(data)) return { ok: false, error: "Doklad byl odebrán." };

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const companyDoc = (companySnap.data() ?? {}) as Record<string, unknown>;
  const banks = await loadOrgBankAccountsAdmin(db, companyId);
  const relatedNum =
    trim(data.type) === JOB_INVOICE_TYPES.TAX_RECEIPT
      ? await relatedAdvanceNumber(db, companyId, data)
      : null;

  const resolved = resolveInvoiceDisplayHtml({
    invoiceDoc: data,
    companyDoc,
    orgBankAccounts: banks,
    relatedAdvanceInvoiceNumber: relatedNum,
  });

  return {
    ok: true,
    html: resolved.html,
    source: resolved.source,
    templateVersion: resolved.templateVersion,
    hasOriginalArchive: resolved.hasOriginalArchive,
    outdated: isInvoicePdfTemplateOutdated(data, String(data.pdfHtml ?? "")),
  };
}

export type PersistInvoicePreviewResult =
  | { ok: true; html: string; archivedOriginal: boolean }
  | { ok: false; error: string };

/** Uloží náhled v aktuální šabloně; `pdfHtml` (originál) nemění — archivuje při první aktualizaci. */
export async function persistInvoicePdfPreviewAdmin(
  db: Firestore,
  companyId: string,
  invoiceId: string,
  userId: string
): Promise<PersistInvoicePreviewResult> {
  const iref = db.collection(COMPANIES_COLLECTION).doc(companyId).collection("invoices").doc(invoiceId);
  const snap = await iref.get();
  if (!snap.exists) return { ok: false, error: "Doklad nenalezen." };
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  if (!isActiveFirestoreDoc(data)) return { ok: false, error: "Doklad byl odebrán." };

  const companySnap = await db.collection(COMPANIES_COLLECTION).doc(companyId).get();
  const companyDoc = (companySnap.data() ?? {}) as Record<string, unknown>;
  const banks = await loadOrgBankAccountsAdmin(db, companyId);
  const relatedNum =
    trim(data.type) === JOB_INVOICE_TYPES.TAX_RECEIPT
      ? await relatedAdvanceNumber(db, companyId, data)
      : null;

  const rebuilt = rebuildInvoiceHtmlFromDocument({
    invoiceDoc: data,
    companyDoc,
    orgBankAccounts: banks,
    relatedAdvanceInvoiceNumber: relatedNum,
  });
  if (!rebuilt.ok) return { ok: false, error: rebuilt.reason };

  const original = trim(data.pdfHtml);
  const archive = trim(data[INVOICE_PDF_FIELD_ARCHIVE]);
  const patch: Record<string, unknown> = {
    [INVOICE_PDF_FIELD_PREVIEW]: rebuilt.html,
    [INVOICE_PDF_FIELD_PREVIEW_VERSION]: INVOICE_PDF_TEMPLATE_VERSION,
    pdfPreviewUpdatedAt: FieldValue.serverTimestamp(),
    pdfPreviewUpdatedBy: userId,
  };
  let archivedOriginal = false;
  if (original && !archive) {
    patch[INVOICE_PDF_FIELD_ARCHIVE] = original;
    patch[INVOICE_PDF_FIELD_ARCHIVE_AT] = FieldValue.serverTimestamp();
    archivedOriginal = true;
  }

  await iref.update(patch);
  return { ok: true, html: rebuilt.html, archivedOriginal };
}

export type BulkRefreshOneResult = {
  invoiceId: string;
  ok: boolean;
  error?: string;
};

export async function bulkRefreshInvoicePreviewsAdmin(
  db: Firestore,
  companyId: string,
  userId: string,
  options: { invoiceIds?: string[]; limit?: number; startAfterId?: string | null }
): Promise<{
  processed: BulkRefreshOneResult[];
  nextStartAfterId: string | null;
  done: boolean;
}> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const results: BulkRefreshOneResult[] = [];

  if (options.invoiceIds && options.invoiceIds.length > 0) {
    for (const id of options.invoiceIds.slice(0, limit)) {
      const r = await persistInvoicePdfPreviewAdmin(db, companyId, id, userId);
      results.push({
        invoiceId: id,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
      });
    }
    return { processed: results, nextStartAfterId: null, done: true };
  }

  let q = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("invoices")
    .orderBy("__name__")
    .limit(limit);

  const startAfter = trim(options.startAfterId);
  if (startAfter) {
    const cursor = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("invoices")
      .doc(startAfter)
      .get();
    if (cursor.exists) {
      q = q.startAfter(cursor);
    }
  }

  const snap = await q.get();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!isActiveFirestoreDoc(data)) {
      results.push({ invoiceId: d.id, ok: false, error: "V koši." });
      continue;
    }
    if (!trim(data.pdfHtml) && !Array.isArray(data.items)) {
      results.push({ invoiceId: d.id, ok: false, error: "Bez dat pro obnovu." });
      continue;
    }
    const r = await persistInvoicePdfPreviewAdmin(db, companyId, d.id, userId);
    results.push({ invoiceId: d.id, ok: r.ok, error: r.ok ? undefined : r.error });
  }

  const last = snap.docs[snap.docs.length - 1];
  const nextStartAfterId = last ? last.id : null;
  const done = snap.size < limit;
  return { processed: results, nextStartAfterId, done };
}
