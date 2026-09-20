import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import {
  loadAccessibleAccountIdSet,
  messageBelongsToUser,
} from "@/lib/email-mailbox/account-access";
import { emailMessagesCol, computeFolderCounts } from "@/lib/email-mailbox/message-store";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const accessibleIds = await loadAccessibleAccountIdSet(perm.db, companyId, perm.caller.uid);
  if (accessibleIds.size === 0) {
    return NextResponse.json({ ok: true, counts: {} });
  }

  const snap = await emailMessagesCol(perm.db, companyId).orderBy("receivedAt", "desc").limit(200).get();
  const rows = snap.docs
    .map((d) => d.data() as EmailMessageDoc)
    .filter((m) => messageBelongsToUser(m, perm.caller.uid, accessibleIds));

  const counts = computeFolderCounts(rows, perm.caller.uid);
  return NextResponse.json({ ok: true, counts });
}
