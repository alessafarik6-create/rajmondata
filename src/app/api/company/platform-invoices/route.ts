import { NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  listPlatformInvoicesForOrganization,
  computeEffectivePlatformInvoiceStatus,
} from "@/lib/platform-billing";
import { COMPANIES_COLLECTION, PLATFORM_SETTINGS_COLLECTION } from "@/lib/firestore-collections";
import { PLATFORM_BILLING_PROVIDER_DOC } from "@/lib/platform-config";
import {
  buildInvoicePaymentQr,
  convertToIban,
  parsePaymentAccountString,
} from "@/lib/invoice-billing-meta";
import { computePlatformBillingClientSummary } from "@/lib/platform-invoice-payment-server";
import { serializePlatformInvoiceRowForApi } from "@/lib/platform-invoice-serialize";

function canReadPlatformBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant";
}

/**
 * Seznam faktur provozovatele platformy pro přihlášenou organizaci (jen čtení).
 */
export async function GET(request: Request) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;
  if (!canReadPlatformBilling(caller.role)) {
    return NextResponse.json({ error: "Přístup jen pro vlastníka, administrátora nebo účetního." }, { status: 403 });
  }
  try {
    const rows = await listPlatformInvoicesForOrganization(db, caller.companyId);
    const eff = (r: (typeof rows)[number]) =>
      computeEffectivePlatformInvoiceStatus(String(r.status), r.dueDate as string);
    const unpaidCount = rows.filter((r) => {
      const e = eff(r);
      return e === "unpaid" || e === "overdue";
    }).length;
    const overdueCount = rows.filter((r) => eff(r) === "overdue").length;

    const compSnap = await db.collection(COMPANIES_COLLECTION).doc(caller.companyId).get();
    const compData = (compSnap.data() ?? {}) as Record<string, unknown>;
    const companyIsActive = compData.isActive !== false && compData.active !== false;
    const billing = computePlatformBillingClientSummary({
      rows,
      companyIsActive,
      platformBillingSuspension: compData.platformBillingSuspension,
    });

    let provider: Record<string, unknown> | null = null;
    try {
      const ps = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(PLATFORM_BILLING_PROVIDER_DOC).get();
      provider = ps.exists ? (ps.data() as Record<string, unknown>) : null;
    } catch {
      provider = null;
    }

    const enriched = rows.map((r) => {
      const e = eff(r);
      const out = serializePlatformInvoiceRowForApi({ ...r } as Record<string, unknown>);
      if (e === "paid" || e === "cancelled") {
        out.paymentQr = null;
        return out;
      }
      if (!provider) {
        out.paymentQr = { qrUrl: "", spd: "", warning: "Chybí nastavení provozovatele." };
        return out;
      }
      const accRaw = String(provider.accountNumber || "").trim();
      const { accountNumber, bankCode, iban: parsedIban } = parsePaymentAccountString(accRaw);
      const ibanResolved =
        String(provider.iban || "").trim() ||
        (parsedIban ? parsedIban : convertToIban(accountNumber, bankCode) || "") ||
        null;
      const invNum = String(r.invoiceNumber || r.id || "").trim();
      const qr = buildInvoicePaymentQr({
        iban: ibanResolved,
        bankAccountNumber: accountNumber,
        bankCode,
        amountGross: Number(r.total),
        variableSymbol: String(r.variableSymbol || "").trim() || null,
        message: `FA ${invNum}`.slice(0, 60),
      });
      out.paymentQr = qr
        ? { qrUrl: qr.qrUrl, spd: qr.spd, warning: qr.warning }
        : { qrUrl: "", spd: "", warning: "QR nelze vytvořit." };
      return out;
    });

    return NextResponse.json({ invoices: enriched, unpaidCount, overdueCount, billing });
  } catch (e) {
    console.error("[company platform-invoices GET]", e);
    const msg = e instanceof Error ? e.message : "Načtení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
