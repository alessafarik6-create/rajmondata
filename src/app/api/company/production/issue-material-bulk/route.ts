import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { canIssueMaterialToJob } from "@/lib/production-material-issue-access";
import { executeMaterialIssueInAdminTransaction } from "@/lib/production-issue-material-in-tx";

const MAX_LINES = 40;

type LineBody = {
  itemId?: string;
  quantity?: unknown;
  note?: string | null;
  batchNumber?: string | null;
  inputLengthUnit?: unknown;
};

type Body = {
  jobId?: string;
  lines?: LineBody[];
  note?: string | null;
};

/**
 * Hromadný výdej materiálu na zakázku v jedné Firestore transakci.
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
  const linesRaw = body.lines;
  const noteGlobal = body.note != null ? String(body.note).trim().slice(0, 2000) : "";

  if (!jobId) {
    return NextResponse.json({ error: "Chybí jobId." }, { status: 400 });
  }
  if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
    return NextResponse.json({ error: "Přidejte alespoň jednu položku k výdeji." }, { status: 400 });
  }
  if (linesRaw.length > MAX_LINES) {
    return NextResponse.json({ error: `Maximálně ${MAX_LINES} řádků najednou.` }, { status: 400 });
  }

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

  const normalized: {
    itemId: string;
    quantity: number;
    note: string;
    batchNumber: string;
    inputLengthUnit: "mm" | "cm" | "m" | null;
  }[] = [];

  for (let i = 0; i < linesRaw.length; i++) {
    const row = linesRaw[i];
    if (!row || typeof row !== "object") {
      return NextResponse.json({ error: `Řádek ${i + 1}: neplatná data.` }, { status: 400 });
    }
    const itemId = String(row.itemId || "").trim();
    const qtyNum =
      typeof row.quantity === "number" && Number.isFinite(row.quantity)
        ? row.quantity
        : Number(String(row.quantity ?? "").replace(",", "."));
    if (!itemId || !Number.isFinite(qtyNum) || qtyNum <= 0) {
      return NextResponse.json(
        { error: `Řádek ${i + 1}: vyplňte platné itemId a kladné množství (číslo).` },
        { status: 400 }
      );
    }
    const inputLenRaw = row.inputLengthUnit;
    const inputLengthUnit: "mm" | "cm" | "m" | null =
      inputLenRaw === "mm" || inputLenRaw === "cm" || inputLenRaw === "m" ? inputLenRaw : null;
    const lineNote = row.note != null ? String(row.note).trim().slice(0, 2000) : "";
    const batchNumber = row.batchNumber != null ? String(row.batchNumber).trim().slice(0, 120) : "";
    const noteParts = [lineNote, noteGlobal].filter((x) => x.length > 0);
    const noteJoined = noteParts.join(" · ").slice(0, 2000);
    normalized.push({
      itemId,
      quantity: qtyNum,
      note: noteJoined,
      batchNumber,
      inputLengthUnit,
    });
  }

  const bulkIssueGroupId = randomUUID();
  const bulkIssueLineCount = normalized.length;

  const ctx = {
    db,
    companyId: caller.companyId,
    jobId,
    jobName,
    callerUid: caller.uid,
    callerEmployeeId: caller.employeeId,
    createdByName,
  };

  try {
    const results = await (db as Firestore).runTransaction(async (tx) => {
      const out: Awaited<ReturnType<typeof executeMaterialIssueInAdminTransaction>>[] = [];
      for (let i = 0; i < normalized.length; i++) {
        const line = normalized[i];
        try {
          const r = await executeMaterialIssueInAdminTransaction(tx, ctx, {
            itemId: line.itemId,
            quantity: line.quantity,
            inputLengthUnit: line.inputLengthUnit,
            note: line.note,
            batchNumber: line.batchNumber,
            consumptionExtras: {
              bulkIssueGroupId,
              bulkIssueLineIndex: i,
              bulkIssueLineCount,
              isBulkMaterialIssue: true,
            },
          });
          out.push(r);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Výdej se nezdařil.";
          throw new Error(`Řádek ${i + 1} (${line.itemId}): ${msg}`);
        }
      }
      return out;
    });

    return NextResponse.json({
      ok: true,
      bulkIssueGroupId,
      count: results.length,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Hromadný výdej se nezdařil.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
