import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { isActiveFirestoreDoc } from "@/lib/document-soft-delete";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  const jobId = String(request.nextUrl.searchParams.get("jobId") ?? "").trim();
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "Chybí jobId." }, { status: 400 });
  }

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("documents")
    .where("jobId", "==", jobId)
    .limit(60)
    .get()
    .catch(async () =>
      db.collection(COMPANIES_COLLECTION).doc(companyId).collection("documents").limit(0).get()
    );

  const items = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      if (!isActiveFirestoreDoc(data)) return null;
      const fileName = String(data.fileName ?? data.number ?? "dokument").trim();
      const mime = String(data.mimeType ?? data.fileType ?? "").trim();
      const storagePath = String(data.storagePath ?? "").trim() || null;
      const fileUrl = String(data.fileUrl ?? data.downloadURL ?? "").trim() || null;
      if (!storagePath && !fileUrl) return null;
      return {
        id: `doc-${d.id}`,
        kind: "company_document" as const,
        sourceId: d.id,
        filename: fileName,
        fileType: mime || "application/octet-stream",
        sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : null,
        sourceLabel: "Dokument zakázky" as const,
        storagePath,
        downloadUrl: fileUrl,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, attachments: items });
}
