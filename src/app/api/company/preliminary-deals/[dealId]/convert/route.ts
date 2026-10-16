import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { parsePreliminaryDealDoc } from "@/lib/leads/preliminary-deal-server";
import { buildJobBudgetFirestorePayload } from "@/lib/vat-calculations";
import { allocateJobNumberAdmin } from "@/lib/jobs/job-numbering-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const jobsPerm = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "jobs",
    method: "POST",
  });
  if (!jobsPerm.ok) {
    return NextResponse.json({ ok: false, error: jobsPerm.error }, { status: jobsPerm.status });
  }
  const leadsPerm = await verifyCompanyBearerWithPortalAccess(request.headers.get("authorization"), {
    moduleId: "leads",
    method: "POST",
  });
  if (!leadsPerm.ok) {
    return NextResponse.json({ ok: false, error: leadsPerm.error }, { status: leadsPerm.status });
  }

  const v = jobsPerm;
  const { dealId } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const companyId = String(body.companyId ?? v.caller.companyId).trim();
  if (companyId !== v.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const dealRef = v.db.collection("companies").doc(companyId).collection("preliminary_deals").doc(dealId);
  const jobTagForNumber =
    body.jobTag != null ? String(body.jobTag).trim() || null : null;

  try {
    const prep = await v.db.runTransaction(async (tx) => {
      const dealSnap = await tx.get(dealRef);
      if (!dealSnap.exists) throw new Error("NOT_FOUND");
      const deal = parsePreliminaryDealDoc(dealSnap.id, dealSnap.data() as Record<string, unknown>);
      if (!deal) throw new Error("INVALID_DOC");
      if (deal.convertedJobId?.trim()) {
        return { already: true as const, jobId: deal.convertedJobId.trim() };
      }
      if (deal.status === "prevedeno_do_zakazky") {
        throw new Error("ALREADY_CONVERTED");
      }

      const titleOverride = String(body.title ?? deal.title).trim() || deal.title;
      const priceOverride =
        body.priceAmount !== undefined ? Number(body.priceAmount) : deal.priceAmount;
      const priceAmount = Number.isFinite(priceOverride) ? priceOverride : deal.priceAmount;

      const budgetType = deal.priceVatMode === "without_vat" ? "net" : "gross";
      let budgetFields: ReturnType<typeof buildJobBudgetFirestorePayload> | null = null;
      if (priceAmount > 0) {
        budgetFields = buildJobBudgetFirestorePayload({
          budgetInput: Math.round(priceAmount),
          budgetType,
          vatRate: 21,
        });
      }

      let assignedEmployeeIds: string[] = [v.caller.uid];
      const responsibleId = deal.responsibleEmployeeId?.trim();
      if (responsibleId) {
        const empRef = v.db
          .collection("companies")
          .doc(companyId)
          .collection("employees")
          .doc(responsibleId);
        const empSnap = await tx.get(empRef);
        const authUserId = String(empSnap.data()?.authUserId ?? "").trim();
        assignedEmployeeIds = authUserId ? [responsibleId, authUserId] : [responsibleId];
      }

      return {
        already: false as const,
        deal,
        titleOverride,
        priceAmount,
        budgetFields,
        assignedEmployeeIds,
      };
    });

    if (prep.already) {
      return NextResponse.json({
        ok: true,
        jobId: prep.jobId,
        alreadyConverted: true,
      });
    }

    const { jobNumber, typeId } = await allocateJobNumberAdmin(
      v.db,
      companyId,
      jobTagForNumber
    );

    const jobRef = v.db.collection("companies").doc(companyId).collection("jobs").doc();

    const writeResult = await v.db.runTransaction(async (tx) => {
      const dealSnap = await tx.get(dealRef);
      if (!dealSnap.exists) throw new Error("NOT_FOUND");
      const deal = parsePreliminaryDealDoc(dealSnap.id, dealSnap.data() as Record<string, unknown>);
      if (!deal) throw new Error("INVALID_DOC");
      if (deal.convertedJobId?.trim()) {
        return { already: true as const, jobId: deal.convertedJobId.trim() };
      }

      const jobPayload: Record<string, unknown> = {
        name: prep.titleOverride,
        description: deal.description,
        status: "active",
        jobNumber,
        jobNumberTypeId: typeId,
        companyId,
        customerId: deal.customerId ?? null,
        customerName: deal.customerName ?? "",
        customerPhone: deal.customerPhone ?? "",
        customerEmail: deal.customerEmail ?? "",
        startDate: deal.expectedCompletionDate ?? "",
        endDate: "",
        measuring: false,
        measuringDetails: "",
        assignedEmployeeIds: prep.assignedEmployeeIds,
        preliminaryDealId: dealId,
        sourceLeadId: deal.sourceLeadId ?? null,
        internalNotesFromPreliminaryDeal: deal.note ?? "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: v.caller.uid,
        ...(prep.budgetFields ?? {}),
      };

      tx.set(jobRef, jobPayload);
      tx.set(
        dealRef,
        {
          status: "prevedeno_do_zakazky",
          convertedJobId: jobRef.id,
          convertedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: v.caller.uid,
          title: prep.titleOverride,
          priceAmount: prep.priceAmount,
        },
        { merge: true }
      );

      return { already: false as const, jobId: jobRef.id };
    });

    if (writeResult.already) {
      return NextResponse.json({
        ok: true,
        jobId: writeResult.jobId,
        alreadyConverted: true,
      });
    }
    return NextResponse.json({ ok: true, jobId: writeResult.jobId, jobNumber });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "Předjednaná zakázka nenalezena." }, { status: 404 });
    }
    if (msg === "ALREADY_CONVERTED") {
      return NextResponse.json({ ok: false, error: "Záznam je již převeden." }, { status: 409 });
    }
    console.error("[preliminary-deals convert]", msg);
    return NextResponse.json({ ok: false, error: "Převod do zakázky selhal." }, { status: 500 });
  }
}
