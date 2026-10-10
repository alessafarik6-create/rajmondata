import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";
import { verifyBearerAndLoadCaller } from "@/lib/api-verify-company-user";
import {
  COMPANIES_COLLECTION,
  PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION,
  PLATFORM_ORG_CAMPAIGNS_COLLECTION,
} from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await ctx.params;
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ ok: false, error: "Server" }, { status: 503 });
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const caller = await verifyBearerAndLoadCaller(auth, db, token);
  if (!caller) return NextResponse.json({ ok: false, error: "Neautorizováno" }, { status: 401 });
  const companyId = String(request.nextUrl.searchParams.get("companyId") ?? caller.companyId).trim();
  if (caller.companyId !== companyId) {
    return NextResponse.json({ ok: false, error: "Přístup odepřen." }, { status: 403 });
  }
  const inboxRef = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(PLATFORM_CAMPAIGN_INBOX_SUBCOLLECTION)
    .doc(campaignId);
  const inboxSnap = await inboxRef.get();
  if (!inboxSnap.exists) {
    return NextResponse.json({ ok: false, error: "Zpráva není pro vaši organizaci." }, { status: 404 });
  }
  if (!inboxSnap.data()?.openedAt) {
    await inboxRef.set({ openedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db
      .collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION)
      .doc(campaignId)
      .collection("recipients")
      .doc(companyId)
      .set({ openedAt: FieldValue.serverTimestamp() }, { merge: true });
    const campRef = db.collection(PLATFORM_ORG_CAMPAIGNS_COLLECTION).doc(campaignId);
    const camp = await campRef.get();
    const opened = Number((camp.data()?.stats as { opened?: number })?.opened ?? 0) + 1;
    await campRef.set({ stats: { ...(camp.data()?.stats as object), opened } }, { merge: true });
  }
  return NextResponse.json({ ok: true, campaign: { id: inboxSnap.id, ...inboxSnap.data() } });
}
