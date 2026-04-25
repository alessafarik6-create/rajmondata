import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import { renderStoredHtmlToPdfBuffer } from "@/lib/document-email-pdf-server";
import {
  allocatePlatformInvoiceSequence,
  buildLineRowsFromInput,
  buildPlatformFeeInvoiceHtml,
  companyDocToBillingCustomer,
  formatPlatformInvoiceNumber,
  loadBillingProviderOrThrow,
  loadCompanyDocOrThrow,
  snapshotCustomerFromCompany,
  snapshotSupplierFromProvider,
  sumInvoiceLines,
  type PlatformInvoiceLineInput,
  variableSymbolFromInvoiceNumber,
} from "@/lib/platform-billing";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";

export async function GET(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const orgId = String(request.nextUrl.searchParams.get("organizationId") || "").trim();
  try {
    await ensureAllPlatformData(db);
    const snap = orgId
      ? await db
          .collection(PLATFORM_INVOICES_COLLECTION)
          .where("organizationId", "==", orgId)
          .orderBy("createdAt", "desc")
          .limit(200)
          .get()
      : await db.collection(PLATFORM_INVOICES_COLLECTION).orderBy("createdAt", "desc").limit(200).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ invoices: rows });
  } catch (e) {
    console.error("[superadmin platform-invoices GET]", e);
    const msg = e instanceof Error ? e.message : "Chyba načtení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PostBody = {
  organizationId?: string;
  periodFrom?: string;
  periodTo?: string;
  issueDate?: string;
  dueDate?: string;
  note?: string | null;
  items?: PlatformInvoiceLineInput[];
};

export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getAdminFirestore();
  const bucket = getAdminStorageBucket();
  if (!db || !bucket) {
    return NextResponse.json({ error: "Firebase Admin / Storage není k dispozici." }, { status: 503 });
  }
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const organizationId = String(body.organizationId || "").trim();
  const periodFrom = String(body.periodFrom || "").trim().slice(0, 10);
  const periodTo = String(body.periodTo || "").trim().slice(0, 10);
  const dueDate = String(body.dueDate || "").trim().slice(0, 10);
  const issueDate = (body.issueDate && String(body.issueDate).trim().slice(0, 10)) || "";
  const note = body.note != null ? String(body.note).trim().slice(0, 4000) : "";
  if (!organizationId || !periodFrom || !periodTo || !dueDate) {
    return NextResponse.json(
      { error: "Vyplňte organizationId, periodFrom, periodTo a dueDate (YYYY-MM-DD)." },
      { status: 400 }
    );
  }
  const itemsRaw = Array.isArray(body.items) ? body.items : [];
  if (itemsRaw.length === 0 || itemsRaw.length > 40) {
    return NextResponse.json({ error: "Přidejte 1–40 položek faktury." }, { status: 400 });
  }
  try {
    await ensureAllPlatformData(db);
    const provider = await loadBillingProviderOrThrow(db);
    const company = await loadCompanyDocOrThrow(db, organizationId);
    const seq = await allocatePlatformInvoiceSequence(db);
    const issue = issueDate || new Date().toISOString().slice(0, 10);
    const year = Number(issue.slice(0, 4)) || new Date().getFullYear();
    const invoiceNumber = formatPlatformInvoiceNumber(seq, year);
    const variableSymbol = variableSymbolFromInvoiceNumber(invoiceNumber);
    const lineRows = buildLineRowsFromInput(itemsRaw as PlatformInvoiceLineInput[]);
    const { amountNet, vatAmount, amountGross } = sumInvoiceLines(lineRows);
    const rates = [...new Set(lineRows.map((r) => r.vatRate))];
    const primaryVatLabel = rates.length === 1 ? `${rates[0]} %` : "více sazeb DPH";
    const customer = companyDocToBillingCustomer(company);
    const orgName = String(company.companyName || company.name || organizationId).trim();
    const html = buildPlatformFeeInvoiceHtml({
      billingProvider: provider,
      customer,
      invoiceNumber,
      issueDate: issue,
      dueDate,
      taxSupplyDate: issue,
      periodFrom,
      periodTo,
      items: lineRows,
      amountNet,
      vatAmount,
      amountGross,
      primaryVatLabel,
      note: note || null,
      variableSymbol,
    });
    const pdfBuf = await renderStoredHtmlToPdfBuffer(html);
    const invRef = db.collection(PLATFORM_INVOICES_COLLECTION).doc();
    const invoiceId = invRef.id;
    const storagePath = `platform_invoices/${organizationId}/${invoiceId}.pdf`;
    const f = bucket.file(storagePath);
    await f.save(pdfBuf, {
      metadata: { contentType: "application/pdf", cacheControl: "private, max-age=120" },
    });
    try {
      await f.makePublic();
    } catch (e) {
      console.warn("[platform-invoices POST] makePublic:", e);
    }
    const encoded = encodeURIComponent(storagePath);
    const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media`;
    const supplierSnapshot = snapshotSupplierFromProvider(provider);
    const customerSnapshot = snapshotCustomerFromCompany(organizationId, company);
    await invRef.set({
      id: invoiceId,
      organizationId,
      organizationName: orgName,
      invoiceNumber,
      variableSymbol,
      issueDate: issue,
      dueDate,
      periodFrom,
      periodTo,
      supplier: supplierSnapshot,
      customer: customerSnapshot,
      items: lineRows.map((r, i) => ({
        index: i,
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        unitPriceNet: r.unitPriceNet,
        vatRate: r.vatRate,
        lineNet: r.lineNet,
        lineVat: r.lineVat,
        lineGross: r.lineGross,
      })),
      subtotal: amountNet,
      vatAmount,
      total: amountGross,
      currency: "CZK",
      status: "unpaid",
      pdfUrl,
      storagePath,
      note: note || null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: session.username,
      paidAt: null,
    });
    return NextResponse.json({
      ok: true,
      invoiceId,
      invoiceNumber,
      pdfUrl,
    });
  } catch (e) {
    console.error("[superadmin platform-invoices POST]", e);
    const msg = e instanceof Error ? e.message : "Vystavení faktury se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
