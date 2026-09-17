import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { requireSuperadminSession } from "@/lib/superadmin-guard";
import { sendTestSecurityAlert } from "@/lib/platform-admin-notifications/test-notifications";
import { writeSecurityAudit } from "@/lib/security/security-incidents";

export async function POST() {
  const auth = await requireSuperadminSession();
  if ("response" in auth) return auth.response;

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ error: "Firebase Admin není nakonfigurován." }, { status: 503 });
  }

  const result = await sendTestSecurityAlert(db);
  await writeSecurityAudit(db, {
    action: "test_security_alert",
    actor: auth.session.username,
  });

  return NextResponse.json({
    ok: true,
    internalNotification: result.notificationOk ? "OK" : "CHYBA",
    securityEmail: result.emailOk ? "OK" : "CHYBA",
    emailError: result.emailError ?? null,
  });
}
