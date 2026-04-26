import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import {
  createSupportTicketAdmin,
  loadCompanyDisplayName,
  normalizeSupportTicketType,
} from "@/lib/support-tickets-server";

function canUseSupport(role: string): boolean {
  return role === "owner" || role === "admin" || role === "manager" || role === "accountant";
}

export async function POST(request: NextRequest) {
  const v = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  if (!canUseSupport(v.caller.role)) {
    return NextResponse.json({ error: "Podporu mohou používat jen oprávněné role firmy." }, { status: 403 });
  }
  let body: { type?: string; subject?: string; message?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Neplatné JSON tělo." }, { status: 400 });
  }
  const type = normalizeSupportTicketType(String(body.type || ""));
  if (!type) {
    return NextResponse.json({ error: "Neplatný typ zprávy." }, { status: 400 });
  }
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  if (!subject || !message) {
    return NextResponse.json({ error: "Vyplňte předmět i zprávu." }, { status: 400 });
  }
  try {
    const orgName = await loadCompanyDisplayName(v.db, v.caller.companyId);
    const id = await createSupportTicketAdmin(v.db, {
      organizationId: v.caller.companyId,
      organizationName: orgName,
      type,
      subject,
      firstMessage: message,
      createdByUid: v.caller.uid,
    });
    return NextResponse.json({ ok: true, ticketId: id });
  } catch (e) {
    console.error("[company support-tickets POST]", e);
    const msg = e instanceof Error ? e.message : "Uložení se nezdařilo.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
