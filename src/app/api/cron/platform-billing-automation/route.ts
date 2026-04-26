import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore, getAdminStorageBucket } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  addCalendarDaysIso,
  billingAutomationFirestorePayload,
  buildAutomaticPlatformInvoiceLineInputs,
  loadDefaultEmployeePriceCzk,
  loadLicenseAndCompanyForAutoInvoice,
  loadMergedCatalogFromFirestore,
  loadPlatformPricingDoc,
  normalizeBillingAutomation,
} from "@/lib/platform-invoice-auto";
import { issuePlatformInvoiceAdmin } from "@/lib/platform-invoice-issue";
import { ensureAllPlatformData } from "@/lib/superadmin-platform-seed";
import { sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Automatické vystavení faktur organizacím (cron).
 * GET /api/cron/platform-billing-automation?secret=... (stejný CRON_SECRET jako u ostatních cronů)
 */
export async function GET(request: NextRequest) {
  try {
    const secret = String(process.env.CRON_SECRET ?? "").trim();
    const q = request.nextUrl.searchParams.get("secret") ?? "";
    if (!secret || q !== secret) {
      return NextResponse.json({ ok: false, error: "Nepovolený přístup." }, { status: 401 });
    }
    const db = getAdminFirestore();
    const bucket = getAdminStorageBucket();
    if (!db || !bucket) {
      return NextResponse.json({ ok: false, error: "Firebase není k dispozici." }, { status: 503 });
    }
    await ensureAllPlatformData(db);
    const today = todayIso();
    const pricingDefaults = await loadPlatformPricingDoc(db);

    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .where("billingAutomationEnabled", "==", true)
      .where("billingAutomationNextIssueDate", "<=", today)
      .limit(20)
      .get();

    const issued: string[] = [];
    const skipped: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const doc of snap.docs) {
      const companyId = doc.id;
      const raw = (doc.data() as Record<string, unknown>).billingAutomation;
      const state = normalizeBillingAutomation(raw, {
        intervalDays: pricingDefaults.automationDefaultIntervalDays,
        dueDays: pricingDefaults.automationDefaultDueDays,
      });
      if (!state.enabled || !state.nextIssueDate || state.nextIssueDate > today) {
        skipped.push(companyId);
        continue;
      }
      const issue = state.nextIssueDate;
      const periodTo = addCalendarDaysIso(issue, -1);
      const periodFrom = addCalendarDaysIso(issue, -state.intervalDays);
      const dueDate = addCalendarDaysIso(issue, state.dueDays);

      try {
        const [catalog, defEmp, pricing, ctx] = await Promise.all([
          loadMergedCatalogFromFirestore(db),
          loadDefaultEmployeePriceCzk(db),
          loadPlatformPricingDoc(db),
          loadLicenseAndCompanyForAutoInvoice(db, companyId),
        ]);
        const items = buildAutomaticPlatformInvoiceLineInputs({
          platformCompany: ctx.platformCompany,
          license: ctx.license,
          catalog,
          pricing,
          defaultEmployeePriceCzk: defEmp,
          employeeCount: ctx.employeeCount,
          periodFrom,
          periodTo,
        });
        if (items.length === 0) {
          skipped.push(companyId);
          continue;
        }
        const inv = await issuePlatformInvoiceAdmin({
          db,
          bucket,
          organizationId: companyId,
          periodFrom,
          periodTo,
          dueDate,
          issueDate: issue,
          note: `Automaticky vystaveno (${periodFrom} – ${periodTo}).`,
          items,
          createdBy: "cron",
          issueSource: "automation",
        });
        issued.push(companyId);

        const nextIssue = addCalendarDaysIso(issue, state.intervalDays);
        const nextState = normalizeBillingAutomation(
          {
            ...state,
            nextIssueDate: nextIssue,
            lastIssuedAt: today,
          },
          { intervalDays: state.intervalDays, dueDays: state.dueDays }
        );
        const autoPatch = billingAutomationFirestorePayload(nextState);
        await db.collection(COMPANIES_COLLECTION).doc(companyId).set(
          { ...autoPatch, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        await db.collection(ORGANIZATIONS_COLLECTION).doc(companyId).set(
          { ...autoPatch, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );

        if (state.sendEmail) {
          const email = String((doc.data() as Record<string, unknown>).email ?? "").trim();
          if (email) {
            const subj = `Nová faktura ${inv.invoiceNumber} — ${periodFrom} až ${periodTo}`;
            const html = `<p>Dobrý den,</p><p>byla vám vystavena faktura <strong>${inv.invoiceNumber}</strong> za období ${periodFrom} – ${periodTo}.</p><p>Splatnost: <strong>${dueDate}</strong>, celkem k úhradě: <strong>${inv.amountGross.toFixed(2)} Kč</strong> (VS ${inv.variableSymbol}).</p><p>PDF faktury najdete v portálu v sekci Vyúčtování služeb.</p>`;
            await sendTransactionalEmail({ to: [email], subject: subj, html });
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ id: companyId, error: msg });
        console.error("[platform-billing-automation]", companyId, e);
      }
    }

    return NextResponse.json({
      ok: true,
      today,
      candidates: snap.size,
      issued,
      skipped,
      errors,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/platform-billing-automation]", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
