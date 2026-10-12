import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { requirePortalModuleAccess } from "@/lib/portal-permissions-server";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import { fireLeadReminderIfDue } from "@/lib/leads/lead-reminder-fire-server";

export const dynamic = "force-dynamic";

/** Zpracuje splatné připomínky v rámci jedné organizace (volá klient periodicky). */
export async function POST(request: NextRequest) {
  const auth = await verifyCompanyBearer(request.headers.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const perm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "read");
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  const companyId = auth.caller.companyId;
  const now = Timestamp.now();
  const qs = await auth.db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION)
    .where("status", "==", "active")
    .where("notificationFired", "==", false)
    .where("remindAt", "<=", now)
    .orderBy("remindAt", "asc")
    .limit(20)
    .get();

  let fired = 0;
  const errors: string[] = [];
  for (const docSnap of qs.docs) {
    try {
      const r = await fireLeadReminderIfDue(auth.db, companyId, docSnap.id);
      if (r.fired) fired++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ ok: true, checked: qs.size, fired, errors });
}
