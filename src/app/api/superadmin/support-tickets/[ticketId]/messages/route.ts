import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { appendSupportMessageAdmin } from "@/lib/support-tickets-server";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ ticketId: string }> }
) {
  const session = await getSessionFromCookie();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Přístup jen pro superadministrátora." }, { status: 403 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  const { ticketId } = await ctx.params;
  const id = String(ticketId || "").trim();
  if (!id) return NextResponse.json({ error: "Chybí ticketId." }, { status: 400 });
  let body: { message?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const message = String(body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "Zpráva je prázdná." }, { status: 400 });
  }
  const snap = await db.collection(SUPPORT_TICKETS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Ticket neexistuje." }, { status: 404 });
  try {
    await appendSupportMessageAdmin(db, id, { senderRole: "admin", message });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odeslání se nezdařilo.";
    const code = msg.includes("uzavřen") ? 409 : 500;
    if (code === 500) console.error("[superadmin support-tickets messages POST]", e);
    return NextResponse.json({ error: msg }, { status: code });
  }
}
