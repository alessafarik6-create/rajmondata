import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getSessionFromCookie } from "@/lib/superadmin-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { normalizeSupportTicketStatus } from "@/lib/support-tickets-server";

function tsToIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && typeof (v as { toDate?: () => Date }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && v !== null) {
    const s = Number((v as { seconds?: number }).seconds ?? (v as { _seconds?: number })._seconds);
    if (Number.isFinite(s)) return new Date(s * 1000).toISOString();
  }
  return null;
}

export async function GET(
  _request: NextRequest,
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
  try {
    const ref = db.collection(SUPPORT_TICKETS_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Ticket neexistuje." }, { status: 404 });
    const data = snap.data() as Record<string, unknown>;
    const msgSnap = await ref.collection("messages").orderBy("createdAt", "asc").get();
    const messages = msgSnap.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        senderRole: m.senderRole,
        message: m.message,
        createdAt: tsToIso(m.createdAt),
      };
    });
    return NextResponse.json({
      ticket: {
        id,
        organizationId: data.organizationId,
        organizationName: data.organizationName,
        type: data.type,
        subject: data.subject,
        status: data.status,
        createdAt: tsToIso(data.createdAt),
        updatedAt: tsToIso(data.updatedAt),
        lastMessageText: data.lastMessageText ?? null,
      },
      messages,
    });
  } catch (e) {
    console.error("[superadmin support-tickets GET id]", e);
    const msg = e instanceof Error ? e.message : "Chyba načtení.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PatchBody = { status?: string };

export async function PATCH(
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
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const st = normalizeSupportTicketStatus(String(body.status || ""));
  if (!st) {
    return NextResponse.json({ error: "Neplatný status." }, { status: 400 });
  }
  try {
    const ref = db.collection(SUPPORT_TICKETS_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Ticket neexistuje." }, { status: 404 });
    await ref.set(
      {
        status: st,
        updatedAt: FieldValue.serverTimestamp(),
        statusUpdatedBy: session.username,
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[superadmin support-tickets PATCH]", e);
    const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
