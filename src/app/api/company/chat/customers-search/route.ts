import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const v = await verifyCompanyBearerWithPortalAccess(
    request.headers.get("authorization"),
    { moduleId: "jobs", method: "GET" }
  );
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: v.status });
  }
  const companyId = v.caller.companyId;
  const q = String(request.nextUrl.searchParams.get("q") ?? "")
    .trim()
    .toLowerCase();

  try {
    const snap = await v.db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .limit(250)
      .get();

    type Row = { id: string; label: string; hay: string };
    let rows: Row[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const name = String(data.name ?? data.companyName ?? data.fullName ?? "Zákazník").trim();
      const email = String(data.email ?? "").trim();
      const phone = String(data.phone ?? data.telefon ?? "").trim();
      const label = [name, email, phone].filter(Boolean).join(" · ");
      const hay = [d.id, name, email, phone].join(" ").toLowerCase();
      return { id: d.id, label: label || name, hay };
    });

    if (q.length >= 1) rows = rows.filter((r) => r.hay.includes(q));
    const customers = rows.slice(0, 30).map(({ id, label }) => ({ id, label }));
    return NextResponse.json({ ok: true, customers });
  } catch {
    return NextResponse.json({ ok: false, error: "Načtení zákazníků se nezdařilo." }, { status: 500 });
  }
}
