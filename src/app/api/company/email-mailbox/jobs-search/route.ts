import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

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
  if (q.length < 2) {
    return NextResponse.json({ ok: true, jobs: [] });
  }

  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("jobs")
    .limit(80)
    .get();

  const jobs = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const orderNumber = String(data.orderNumber ?? data.jobNumber ?? "").trim();
      const title = String(data.title ?? data.name ?? "").trim();
      const customerName = String(data.customerName ?? data.clientName ?? "").trim();
      const address = String(data.address ?? data.siteAddress ?? "").trim();
      const hay = `${orderNumber} ${title} ${customerName} ${address} ${d.id}`.toLowerCase();
      return {
        id: d.id,
        orderNumber,
        title,
        customerName,
        address,
        hay,
      };
    })
    .filter((j) => j.hay.includes(q))
    .slice(0, 20)
    .map(({ hay: _h, ...rest }) => rest);

  return NextResponse.json({ ok: true, jobs });
}
