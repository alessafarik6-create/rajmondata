import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import {
  jobSearchHaystackFromJobData,
  mapFirestoreJobToPickerRow,
} from "@/lib/email-mailbox/job-picker-label";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const perm = await requireEmailMailboxRead(request);
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server error." }, { status: 503 });

  const companyId =
    String(request.nextUrl.searchParams.get("companyId") ?? "").trim() || perm.caller.companyId;
  if (!emailMailboxTenantOk(perm.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const q = String(request.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .toLowerCase();

  try {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("jobs")
      .limit(200)
      .get();

    let rows = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const org = String(data.organizationId ?? data.companyId ?? "").trim();
        if (org && org !== companyId) return null;
        const row = mapFirestoreJobToPickerRow(d.id, data);
        const hay = jobSearchHaystackFromJobData(d.id, data);
        return { ...row, hay };
      })
      .filter(Boolean) as (ReturnType<typeof mapFirestoreJobToPickerRow> & { hay: string })[];

    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);

    if (q.length >= 1) {
      rows = rows.filter((j) => j.hay.includes(q));
    }

    const jobs = rows.slice(0, 30).map(({ hay: _h, updatedAtMs: _u, ...rest }) => rest);

    return NextResponse.json({ ok: true, jobs });
  } catch (e) {
    console.error("[email-mailbox/jobs-search]", e);
    return NextResponse.json(
      { ok: false, error: "Nepodařilo se načíst zakázky." },
      { status: 500 }
    );
  }
}
