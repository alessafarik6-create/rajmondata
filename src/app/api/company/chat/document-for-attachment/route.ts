import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyPortalMutation } from "@/lib/portal-api-mutation";
import { getAdminFirestore } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/** Dohledá documentId pro staré chatové přílohy bez linkedDocumentId. */
export async function GET(request: NextRequest) {
  const perm = await verifyCompanyPortalMutation(request, "documents");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });
  }

  const companyId = String(
    request.nextUrl.searchParams.get("companyId") ?? perm.caller.companyId
  ).trim();
  const messageId = String(request.nextUrl.searchParams.get("messageId") ?? "").trim();
  const attachmentId = String(request.nextUrl.searchParams.get("attachmentId") ?? "").trim();

  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }
  if (!messageId || !attachmentId) {
    return NextResponse.json(
      { ok: false, error: "Chybí messageId nebo attachmentId." },
      { status: 400 }
    );
  }

  const snap = await db
    .collection("companies")
    .doc(companyId)
    .collection("documents")
    .where("sourceChatMessageId", "==", messageId)
    .where("sourceAttachmentId", "==", attachmentId)
    .limit(1)
    .get()
    .catch(() => null);

  const doc = snap?.docs?.[0];
  if (!doc) {
    return NextResponse.json({ ok: true, documentId: null });
  }
  return NextResponse.json({ ok: true, documentId: doc.id });
}
