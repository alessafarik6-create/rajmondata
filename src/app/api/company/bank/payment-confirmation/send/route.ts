import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireBankWrite, bankTenantOk } from "@/lib/bank/api-auth";
import { bankConnectionsCol } from "@/lib/bank/collections";
import { loadBankConnection } from "@/lib/bank/connection-store";
import {
  isVerifiedCustomerInvoiceEmail,
  sendPaymentConfirmationForMatch,
} from "@/lib/bank/payment-confirmation";
import { bankMatchesCol } from "@/lib/bank/collections";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const perm = await requireBankWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    matchId?: string;
    emailAccountId?: string;
    to?: string;
    subject?: string;
    textBody?: string;
    htmlBody?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné JSON." }, { status: 400 });
  }

  const organizationId = String(body.companyId ?? "").trim() || perm.caller.companyId;
  if (!bankTenantOk(perm.caller, organizationId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const matchId = String(body.matchId ?? "").trim();
  const emailAccountId = String(body.emailAccountId ?? "").trim();
  if (!matchId || !emailAccountId) {
    return NextResponse.json({ ok: false, error: "Chybí matchId nebo emailAccountId." }, { status: 400 });
  }

  const matchSnap = await bankMatchesCol(perm.db, organizationId).doc(matchId).get();
  if (!matchSnap.exists) {
    return NextResponse.json({ ok: false, error: "Spárování nenalezeno." }, { status: 404 });
  }
  const match = matchSnap.data() as Record<string, unknown>;
  if (match.paymentConfirmationSentAt) {
    return NextResponse.json({ ok: false, error: "Potvrzení už bylo odesláno." }, { status: 409 });
  }

  const to = isVerifiedCustomerInvoiceEmail(body.to);
  if (!to) {
    return NextResponse.json({ ok: false, error: "Neplatný e-mail příjemce." }, { status: 400 });
  }

  const subject = String(body.subject ?? "").trim();
  const textBody = String(body.textBody ?? "").trim();
  if (!subject || !textBody) {
    return NextResponse.json({ ok: false, error: "Vyplňte předmět a text." }, { status: 400 });
  }

  const draft = {
    to,
    customerName: "",
    subject,
    textBody,
    htmlBody: String(body.htmlBody ?? "").trim() || undefined,
    invoiceNumber: "",
    amountFormatted: "",
    paidAtFormatted: "",
    organizationName: "",
  };

  try {
    const result = await sendPaymentConfirmationForMatch(perm.db, {
      organizationId,
      matchId,
      emailAccountId,
      actorUserId: perm.caller.uid,
      draft: {
        ...draft,
        htmlBody: draft.htmlBody ?? textBody.replace(/\n/g, "<br/>"),
      },
    });

    const conn = await loadBankConnection(perm.db, organizationId);
    const prev = conn?.automationStats ?? {};
    await bankConnectionsCol(perm.db, organizationId).doc(conn?.id ?? "raiffeisen").set(
      {
        automationStats: {
          ...prev,
          confirmationsSentTotal: Number(prev.confirmationsSentTotal ?? 0) + (result.sent ? 1 : 0),
          lastConfirmationSentAt: result.sent ? new Date().toISOString() : prev.lastConfirmationSentAt,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      sent: result.sent,
      skippedReason: result.skippedReason ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Odeslání selhalo." },
      { status: 500 }
    );
  }
}
