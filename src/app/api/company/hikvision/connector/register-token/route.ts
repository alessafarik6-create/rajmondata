import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { hikvisionIntegrationRef } from "@/lib/hikvision/stores";
import {
  hikvisionTenantOk,
  requireHikvisionIntegrationAdmin,
} from "@/lib/hikvision/api-auth";

export const dynamic = "force-dynamic";

/** Vygeneruje jednorázový registrační token pro Local Connector (zobrazí se adminovi). */
export async function POST(request: NextRequest) {
  const auth = await requireHikvisionIntegrationAdmin(request);
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
  if (!hikvisionTenantOk(auth.caller, companyId)) {
    return NextResponse.json({ ok: false, error: "Neplatná organizace." }, { status: 403 });
  }

  const token = randomBytes(24).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await hikvisionIntegrationRef(auth.db, companyId).set(
    {
      pendingRegistrationTokenHash: hash,
      pendingRegistrationExpiresAt: expires,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json({
    ok: true,
    registrationToken: token,
    expiresAt: expires.toISOString(),
    message: "Token zadejte do RAJMONDATA Local Connector (platnost 1 hodina).",
  });
}
