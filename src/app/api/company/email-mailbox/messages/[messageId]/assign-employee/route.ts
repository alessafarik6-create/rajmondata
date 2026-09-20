import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireEmailMailboxWrite } from "@/lib/email-mailbox/api-auth";
import { assertMessageAccess } from "@/lib/email-mailbox/account-access";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { emailMessagesCol } from "@/lib/email-mailbox/message-store";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { EMAIL_SUBCOLLECTION_ASSIGNMENTS } from "@/lib/email-mailbox/intelligence-types";
import { appendEmailMessageTimeline } from "@/lib/email-mailbox/message-timeline";
import { logEmailMailboxAudit } from "@/lib/email-mailbox/audit-server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ messageId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const perm = await requireEmailMailboxWrite(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  let body: {
    companyId?: string;
    assigneeUserId?: string;
    assigneeEmployeeId?: string | null;
    note?: string | null;
    dueAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Neplatné tělo." }, { status: 400 });
  }

  const companyId = String(body.companyId ?? perm.caller.companyId).trim();
  const assigneeUserId = String(body.assigneeUserId ?? "").trim();
  if (!assigneeUserId) {
    return NextResponse.json({ ok: false, error: "Vyberte pracovníka." }, { status: 400 });
  }
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { messageId } = await ctx.params;
  const access = await assertMessageAccess(perm.db, companyId, messageId, perm.caller.uid, "write");
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }
  const m = access.message;

  const dueAt = body.dueAt ? Timestamp.fromDate(new Date(body.dueAt)) : null;

  await emailMessagesCol(perm.db, companyId).doc(messageId).update({
    assignedToUserId: assigneeUserId,
    assignedByUserId: perm.caller.uid,
    assignedToEmployeeId: body.assigneeEmployeeId ?? null,
    assignmentNote: body.note ?? null,
    assignmentDueAt: dueAt,
    assignmentStatus: "pending",
    workflowState: "delegated",
    updatedAt: FieldValue.serverTimestamp(),
  });

  await perm.db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(EMAIL_SUBCOLLECTION_ASSIGNMENTS)
    .add({
      organizationId: companyId,
      emailAccountId: m.emailAccountId,
      messageId,
      ownerUserId: m.ownerUserId ?? perm.caller.uid,
      assignedByUserId: perm.caller.uid,
      assigneeUserId,
      assigneeEmployeeId: body.assigneeEmployeeId ?? null,
      note: body.note ?? null,
      dueAt,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await appendEmailMessageTimeline(perm.db, companyId, messageId, {
    kind: "assigned",
    label: "Přiřazeno pracovníkovi",
    userId: perm.caller.uid,
    metadata: { assigneeUserId, dueAt: body.dueAt ?? null },
  });

  await logEmailMailboxAudit(perm.db, companyId, {
    actionType: "email_assigned_employee",
    actionLabel: "Interní přiřazení e-mailu",
    userId: perm.caller.uid,
    entityId: messageId,
    metadata: { assigneeUserId },
  });

  return NextResponse.json({ ok: true });
}
