import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireFleetIntegrationAdmin, fleetTenantOk } from "@/lib/fleet/api-auth";
import { fleetIntegrationRef } from "@/lib/fleet/stores";
import { resolveFleetProviderForOrg } from "@/lib/fleet/providers";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireFleetIntegrationAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const companyId = String(body.companyId ?? auth.caller.companyId).trim();
  if (!fleetTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const { provider } = await resolveFleetProviderForOrg(auth.db, companyId);
  const test = await provider.testConnection();

  await fleetIntegrationRef(auth.db, companyId).set(
    {
      lastTestAt: FieldValue.serverTimestamp(),
      lastError: test.ok ? null : test.message.slice(0, 500),
      status: test.ok ? "configured" : "error",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({ ...test, ok: test.ok });
}
