import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canIssueMaterialToJob } from "@/lib/production-material-issue-access";
import { executeMaterialIssueInAdminTransaction } from "@/lib/production-issue-material-in-tx";

type Body = {
  jobId?: string;
  itemId?: string;
  quantity?: number;
  note?: string | null;
  batchNumber?: string | null;
  inputLengthUnit?: "mm" | "cm" | "m" | null;
};

/**
 * Výdej materiálu ze skladu na zakázku (transakce: sklad + pohyb + spotřeba).
 */
export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  const itemId = String(body.itemId || "").trim();
  const qtyRaw = body.quantity;
  if (!jobId || !itemId || typeof qtyRaw !== "number" || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
    return NextResponse.json(
      { error: "Vyplňte platné jobId, itemId a kladné množství." },
      { status: 400 }
    );
  }

  const inputLenRaw = body.inputLengthUnit;
  const inputLengthUnit: "mm" | "cm" | "m" | null =
    inputLenRaw === "mm" || inputLenRaw === "cm" || inputLenRaw === "m" ? inputLenRaw : null;

  const perm = await canIssueMaterialToJob({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) {
    return NextResponse.json({ error: perm.error }, { status: perm.status });
  }

  const userSnap = await db.collection("users").doc(caller.uid).get();
  const u = userSnap.data() as Record<string, unknown> | undefined;
  const createdByName =
    (typeof u?.displayName === "string" && u.displayName.trim()
      ? u.displayName.trim()
      : null) ||
    (typeof u?.email === "string" && u.email.includes("@")
      ? String(u.email).split("@")[0]
      : null) ||
    caller.uid;

  const jobSnap = await db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .doc(jobId)
    .get();
  const jobData = jobSnap.data() as Record<string, unknown> | undefined;
  const jobName =
    jobData && typeof jobData.name === "string" && jobData.name.trim()
      ? jobData.name.trim()
      : jobId;

  const note = body.note != null ? String(body.note).trim().slice(0, 2000) : "";
  const batchNumber =
    body.batchNumber != null ? String(body.batchNumber).trim().slice(0, 120) : "";

  try {
    const result = await (db as Firestore).runTransaction(async (tx) => {
      return executeMaterialIssueInAdminTransaction(
        tx,
        {
          db,
          companyId: caller.companyId,
          jobId,
          jobName,
          callerUid: caller.uid,
          callerEmployeeId: caller.employeeId,
          createdByName,
        },
        {
          itemId,
          quantity: qtyRaw,
          inputLengthUnit,
          note,
          batchNumber,
        }
      );
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Výdej se nezdařil.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
