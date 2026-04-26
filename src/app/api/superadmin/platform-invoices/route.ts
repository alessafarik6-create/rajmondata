import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import { PLATFORM_INVOICES_COLLECTION } from "@/lib/firestore-collections";
import type { PlatformInvoiceLineInput } from "@/lib/platform-billing";
import {
  buildAutomaticPlatformInvoiceLineInputs,
  loadDefaultEmployeePriceCzk,
  loadLicenseAndCompanyForAutoInvoice,
  loadMergedCatalogFromFirestore,
  loadPlatformPricingDoc,
} from "@/lib/platform-invoice-auto";
import { issuePlatformInvoiceAdmin } from "@/lib/platform-invoice-issue";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";
import { sortPlatformInvoicesByRecencyDesc } from "@/lib/platform-billing";

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
          .limit(300)
          .get()
      : await db.collection(PLATFORM_INVOICES_COLLECTION).limit(400).get();
    const rows = sortPlatformInvoicesByRecencyDesc(
      snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    ).slice(0, 200);
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
  autoFromLicense?: boolean;
  extraItems?: PlatformInvoiceLineInput[];
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
  try {
    await ensureAllPlatformData(db);
    let itemsRaw: PlatformInvoiceLineInput[] = [];
    if (body.autoFromLicense === true) {
      const [pricing, catalog, defEmp, ctx] = await Promise.all([
        loadPlatformPricingDoc(db),
        loadMergedCatalogFromFirestore(db),
        loadDefaultEmployeePriceCzk(db),
        loadLicenseAndCompanyForAutoInvoice(db, organizationId),
      ]);
      itemsRaw = buildAutomaticPlatformInvoiceLineInputs({
        platformCompany: ctx.platformCompany,
        license: ctx.license,
        catalog,
        pricing,
        defaultEmployeePriceCzk: defEmp,
        employeeCount: ctx.employeeCount,
        periodFrom,
        periodTo,
        extraItems: Array.isArray(body.extraItems) ? body.extraItems : undefined,
      });
    } else {
      itemsRaw = Array.isArray(body.items) ? body.items : [];
    }
    if (itemsRaw.length === 0 || itemsRaw.length > 40) {
      return NextResponse.json(
        { error: body.autoFromLicense ? "Žádné automatické položky." : "Přidejte 1–40 položek faktury." },
        { status: 400 }
      );
    }
    const result = await issuePlatformInvoiceAdmin({
      db,
      bucket,
      organizationId,
      periodFrom,
      periodTo,
      dueDate,
      issueDate: issueDate || undefined,
      note: note || null,
      items: itemsRaw,
      createdBy: session.username,
      issueSource: body.autoFromLicense ? "license_auto" : "manual",
    });
    return NextResponse.json({
      ok: true,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      pdfUrl: result.pdfUrl,
    });
  } catch (e) {
    console.error("[superadmin platform-invoices POST]", e);
    const msg = e instanceof Error ? e.message : "Vystavení faktury se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
