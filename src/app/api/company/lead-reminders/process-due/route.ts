import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearer } from "@/lib/api-company-auth";
import { requirePortalModuleAccess } from "@/lib/portal-permissions-server";
import { fireLeadReminderIfDue } from "@/lib/leads/lead-reminder-fire-server";
import { fetchDueLeadReminderDocs } from "@/lib/leads/lead-reminder-query-server";
import { errorMessageFromUnknown } from "@/lib/server-error-serialize";

export const dynamic = "force-dynamic";

/** Zpracuje splatné připomínky v rámci jedné organizace (volá klient periodicky). */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyCompanyBearer(request.headers.get("authorization"));
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const perm = await requirePortalModuleAccess(auth.db, auth.caller, "leads", "read");
    if (!perm.ok) {
      return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
    }

    const companyId = auth.caller.companyId;
    const docs = await fetchDueLeadReminderDocs(auth.db, companyId, 20);

    let fired = 0;
    const errors: string[] = [];
    for (const docSnap of docs) {
      try {
        const r = await fireLeadReminderIfDue(auth.db, companyId, docSnap.id);
        if (r.fired) fired++;
      } catch (e) {
        errors.push(errorMessageFromUnknown(e));
      }
    }

    return NextResponse.json({ ok: true, checked: docs.length, fired, errors });
  } catch (err) {
    console.error("[lead-reminders/process-due]", err);
    return NextResponse.json(
      { ok: false, error: "Připomínky se nepodařilo zpracovat. Zkuste to prosím znovu." },
      { status: 500 }
    );
  }
}
