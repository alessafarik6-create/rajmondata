import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { csvMaterialDraftDocId } from "@/lib/csv-material-draft-id";
import { canIssueMaterialToJob } from "@/lib/production-material-issue-access";

export type CsvMaterialDraftLine = {
  id: string;
  csvLabel: string;
  inventoryItemId: string | null;
  quantity: number;
  inputLengthUnit?: "mm" | "cm" | "m" | null;
};

function normalizeLines(raw: unknown): CsvMaterialDraftLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CsvMaterialDraftLine[] = [];
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

/**
 * GET: načte draft návrhu materiálu z CSV.
 * POST: uloží / aktualizuje draft (bez změny skladu).
 */
export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  const url = new URL(request.url);
  const jobId = String(url.searchParams.get("jobId") || "").trim();
  const folderId = String(url.searchParams.get("folderId") || "").trim();
  const jobFolderImageId = String(url.searchParams.get("jobFolderImageId") || "").trim();
  if (!jobId || !folderId || !jobFolderImageId) {
    return NextResponse.json({ error: "Chybí jobId, folderId nebo jobFolderImageId." }, { status: 400 });
  }

  const perm = await canIssueMaterialToJob({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  const draftId = csvMaterialDraftDocId(folderId, jobFolderImageId);
  const ref = db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("csvMaterialDrafts")
    .doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ draft: null, draftId });
  }
  const d = snap.data() as Record<string, unknown>;
  return NextResponse.json({
    draftId,
    draft: {
      status: d.status === "confirmed" ? "confirmed" : "draft",
      folderId: d.folderId ?? folderId,
      jobFolderImageId: d.jobFolderImageId ?? jobFolderImageId,
      csvFileUrl: typeof d.csvFileUrl === "string" ? d.csvFileUrl : "",
      csvFileName: typeof d.csvFileName === "string" ? d.csvFileName : "",
      lines: normalizeLines(d.lines),
      confirmedAt: d.confirmedAt ?? null,
      updatedAt: d.updatedAt ?? null,
    },
  });
}

type PostBody = {
  jobId?: string;
  folderId?: string;
  jobFolderImageId?: string;
  csvFileUrl?: string;
  csvFileName?: string;
  lines?: unknown;
};

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { db, caller } = v;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }

  const jobId = String(body.jobId || "").trim();
  const folderId = String(body.folderId || "").trim();
  const jobFolderImageId = String(body.jobFolderImageId || "").trim();
  const csvFileUrl = String(body.csvFileUrl || "").trim();
  const csvFileName = String(body.csvFileName || "").trim().slice(0, 500);
  if (!jobId || !folderId || !jobFolderImageId) {
    return NextResponse.json({ error: "Chybí jobId, folderId nebo jobFolderImageId." }, { status: 400 });
  }

  const perm = await canIssueMaterialToJob({ db, companyId: caller.companyId, caller, jobId });
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  const lines = normalizeLines(body.lines);
  const draftId = csvMaterialDraftDocId(folderId, jobFolderImageId);
  const ref = db
    .collection("companies")
    .doc(caller.companyId)
    .collection("jobs")
    .doc(jobId)
    .collection("csvMaterialDrafts")
    .doc(draftId);

  try {
    await (db as Firestore).runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const prev = cur.exists ? (cur.data() as Record<string, unknown>) : null;
      if (prev?.status === "confirmed") {
        throw new Error("confirmed");
      }
      const prevUrl = typeof prev?.csvFileUrl === "string" ? prev.csvFileUrl : "";
      const prevName = typeof prev?.csvFileName === "string" ? prev.csvFileName : "";
      tx.set(
        ref,
        {
          companyId: caller.companyId,
          jobId,
          folderId,
          jobFolderImageId,
          csvFileUrl: csvFileUrl || prevUrl,
          csvFileName: csvFileName || prevName,
          status: "draft",
          lines,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller.uid,
          createdAt: prev?.createdAt ?? FieldValue.serverTimestamp(),
          createdBy: typeof prev?.createdBy === "string" ? prev.createdBy : caller.uid,
        },
        { merge: true }
      );
    });

    return NextResponse.json({ ok: true, draftId });
  } catch (e) {
    if (e instanceof Error && e.message === "confirmed") {
      return NextResponse.json(
        { error: "Tento CSV návrh byl již potvrzen a uzamčen." },
        { status: 400 }
      );
    }
    console.error("[csv-material-draft]", e);
    const msg = e instanceof Error ? e.message : "Uložení draftu se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
