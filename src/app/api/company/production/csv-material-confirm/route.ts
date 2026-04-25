import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { csvMaterialDraftDocId } from "@/lib/csv-material-draft-id";
import { executeMaterialIssueInAdminTransaction } from "@/lib/production-issue-material-in-tx";
import { canIssueMaterialToJob } from "@/lib/production-material-issue-access";

type DraftLine = {
  id: string;
  csvLabel: string;
  inventoryItemId: string | null;
  quantity: number;
  inputLengthUnit?: "mm" | "cm" | "m" | null;
};

function normalizeLines(raw: unknown): DraftLine[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftLine[] = [];
  for (const row of raw.slice(0, 200)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
    const csvLabel = typeof o.csvLabel === "string" ? o.csvLabel.trim().slice(0, 500) : "";
    const inventoryItemId =
      typeof o.inventoryItemId === "string" && o.inventoryItemId.trim() ? o.inventoryItemId.trim() : null;
    const qty = Number(o.quantity);
    const iu = o.inputLengthUnit;
    const inputLengthUnit =
      iu === "mm" || iu === "cm" || iu === "m" ? iu : iu === null || iu === undefined ? null : null;
    if (!id || !csvLabel || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ id, csvLabel, inventoryItemId, quantity: qty, inputLengthUnit });
  }
  return out;
}

type Body = {
  jobId?: string;
  folderId?: string;
  jobFolderImageId?: string;
  note?: string | null;
};

/**
 * Potvrdí návrh materiálu z CSV — jedna transakce: všechny výdeje + uzamčení draftu.
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
  const folderId = String(body.folderId || "").trim();
  const jobFolderImageId = String(body.jobFolderImageId || "").trim();
  const noteGlobal = body.note != null ? String(body.note).trim().slice(0, 1500) : "";

  if (!jobId || !folderId || !jobFolderImageId) {
    return NextResponse.json({ error: "Chybí jobId, folderId nebo jobFolderImageId." }, { status: 400 });
  }

  const perm = await canIssueMaterialToJob({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

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

  const draftId = csvMaterialDraftDocId(folderId, jobFolderImageId);
  const draftRef = db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("csvMaterialDrafts")
    .doc(draftId);

  try {
    const results = await (db as Firestore).runTransaction(async (tx) => {
      const dSnap = await tx.get(draftRef);
      if (!dSnap.exists) {
        throw new Error("Návrh neexistuje — nejdříve vygenerujte návrh z CSV.");
      }
      const d = dSnap.data() as Record<string, unknown>;
      if (d.status === "confirmed") {
        throw new Error("Tento návrh byl již dříve potvrzen.");
      }
      const lines = normalizeLines(d.lines);
      if (lines.length === 0) {
        throw new Error("Návrh neobsahuje žádné řádky.");
      }

      const missing = lines.filter((l) => !l.inventoryItemId);
      if (missing.length) {
        throw new Error(
          `Vyberte skladovou položku u ${missing.length} řádků (např. „${missing[0]?.csvLabel || "?"}“).`
        );
      }

      const csvFileName = typeof d.csvFileName === "string" ? d.csvFileName.trim() : "";

      const out: { consumptionId: string; lineId: string }[] = [];
      for (const line of lines) {
        const itemId = line.inventoryItemId as string;
        const noteParts = [
          noteGlobal,
          `Výdej z CSV${csvFileName ? ` „${csvFileName}“` : ""}`,
          `Řádek: ${line.csvLabel}`,
        ].filter((x) => x.length > 0);
        const note = noteParts.join(" · ").slice(0, 2000);

        const r = await executeMaterialIssueInAdminTransaction(
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
            quantity: line.quantity,
            inputLengthUnit: line.inputLengthUnit ?? null,
            note,
            batchNumber: "",
            consumptionExtras: {
              issuedFromCsvDraft: true,
              csvDraftDocId: draftId,
              csvFolderId: folderId,
              csvJobFolderImageId: jobFolderImageId,
              csvFileName: csvFileName || null,
              csvDraftLineId: line.id,
              csvSourceLabel: line.csvLabel,
            },
          }
        );
        out.push({ consumptionId: r.consumptionId, lineId: line.id });
      }

      tx.update(draftRef, {
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedBy: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller.uid,
        issueResults: out,
      });

      return out;
    });

    return NextResponse.json({ ok: true, issued: results.length, results });
  } catch (e) {
    console.error("[csv-material-confirm]", e);
    const msg = e instanceof Error ? e.message : "Potvrzení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
