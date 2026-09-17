import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { sendTestNewOrganizationNotification } from "@/lib/platform-admin-notifications/test-notifications";
import { writeSecurityAudit } from "@/lib/security/security-incidents";

export async function POST() {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const result = await sendTestNewOrganizationNotification(db);
  await writeSecurityAudit(db, {
    action: "test_new_organization_notification",
    actor: auth.session.username,
  });

  return NextResponse.json({
    ok: true,
    internalNotification: result.notificationOk ? "OK" : "CHYBA",
    email: result.emailOk ? "OK" : "CHYBA",
    emailError: result.emailError ?? null,
  });
}
