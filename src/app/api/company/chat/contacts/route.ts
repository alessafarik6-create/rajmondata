import { NextRequest, NextResponse } from "next/server";
import { verifyCompanyBearerWithPortalAccess } from "@/lib/api-company-auth";
import { loadCompanyChatContacts } from "@/lib/chat-participant-profile";

export const dynamic = "force-dynamic";

/** Seznam interních kontaktů pro chat (read modulu chat — nevyžaduje employees). */
export async function GET(request: NextRequest) {
  const perm = await verifyCompanyBearerWithPortalAccess(
    request.headers.get("authorization"),
    { moduleId: "chat", method: "GET" }
  );
  if (!perm.ok) {
    return NextResponse.json({ ok: false, error: perm.error }, { status: perm.status });
  }

  const url = new URL(request.url);
  const requestedOrg = String(url.searchParams.get("companyId") ?? "").trim();
  const companyId = requestedOrg || perm.caller.companyId;
  if (companyId !== perm.caller.companyId) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const contacts = await loadCompanyChatContacts(perm.db, companyId, perm.caller.uid);

  return NextResponse.json({
    ok: true,
    companyId,
    contacts: contacts.map((c) => ({
      userId: c.userId,
      displayName: c.displayName,
      role: c.role,
      roleLabel: c.roleLabel,
      photoUrl: c.photoUrl || null,
      employeeId: c.employeeId,
    })),
  });
}
