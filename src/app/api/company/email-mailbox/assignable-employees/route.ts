import { NextRequest, NextResponse } from "next/server";
import { requireEmailMailboxRead } from "@/lib/email-mailbox/api-auth";
import { emailMailboxTenantOk } from "@/lib/email-mailbox/api-auth";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

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

  const snap = await perm.db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection("employees")
    .limit(300)
    .get();

  const employees = snap.docs
    .map((d) => {
      const data = d.data() as {
        authUserId?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        active?: boolean;
      };
      const userId = String(data.authUserId ?? "").trim();
      if (!userId) return null;
      const name =
        [data.firstName, data.lastName].filter(Boolean).join(" ").trim() ||
        data.email ||
        userId;
      return {
        employeeId: d.id,
        userId,
        displayName: name,
        email: data.email ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ ok: true, employees });
}
