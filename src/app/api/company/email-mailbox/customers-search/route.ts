import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead, emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
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

  try {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .limit(200)
      .get();

    type Row = { id: string; label: string; hay: string };
    let rows: Row[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const name = String(data.name ?? data.companyName ?? data.fullName ?? "Zákazník").trim();
      const email = String(data.email ?? "").trim();
      const phone = String(data.phone ?? data.telefon ?? "").trim();
      const ico = String(data.ico ?? data.ic ?? "").trim();
      const label = [name, email, phone].filter(Boolean).join(" · ");
      const hay = [d.id, name, email, phone, ico].join(" ").toLowerCase();
      return { id: d.id, label: label || name, hay };
    });

    if (q.length >= 1) {
      rows = rows.filter((r) => r.hay.includes(q));
    }

    const customers = rows.slice(0, 30).map(({ id, label }) => ({ id, label }));

    return NextResponse.json({ ok: true, customers });
  } catch (e) {
    console.error("[email-mailbox/customers-search]", e);
    return NextResponse.json(
      { ok: false, error: "Nepodařilo se načíst zákazníky." },
      { status: 500 }
    );
  }
}
