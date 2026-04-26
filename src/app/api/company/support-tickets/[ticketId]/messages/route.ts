import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { appendSupportMessageAdmin } from "@/lib/support-tickets-server";

function canUseSupport(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager" || role === "accountant";
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ ticketId: string }> }
) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canUseSupport(v.caller.role)) {
    return NextResponse.json({ error: "Podporu mohou používat jen oprávněné role firmy." }, { status: 403 });
  }
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
  const snap = await v.db.collection(SUPPORT_TICKETS_COLLECTION).doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Ticket neexistuje." }, { status: 404 });
  const d = snap.data() as Record<string, unknown>;
  if (String(d.organizationId || "") !== v.caller.companyId) {
    return NextResponse.json({ error: "K tomuto ticketu nemáte přístup." }, { status: 403 });
  }
  try {
    await appendSupportMessageAdmin(v.db, id, { senderRole: "organization", message });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Odeslání se nezdařilo.";
    const code = msg.includes("uzavřen") ? 409 : 500;
    if (code === 500) console.error("[company support-tickets messages POST]", e);
    return NextResponse.json({ error: msg }, { status: code });
  }
}
