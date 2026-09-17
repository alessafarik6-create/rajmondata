import type { Firestore } from "firebase-admin/firestore";
import { SECURITY_THRESHOLDS } from "@/lib/security/security-config";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { recordSecurityIncident } from "@/lib/security/security-incidents";

export async function trackSuperadminFailedLogin(
  db: Firestore,
  ipHash: string,
  userAgent: string
) {
  const rlKey = `superadmin_login_fail:${ipHash}`;
  const rl = await checkFirestoreRateLimit(db, rlKey, {
    limit: SECURITY_THRESHOLDS.superadminFailedLogin.count,
    windowMs: SECURITY_THRESHOLDS.superadminFailedLogin.windowMs,
  });

  if (rl.count >= 3) {
    await recordSecurityIncident(db, {
      type: "SUPERADMIN_FAILED_LOGIN",
      category: "ADMIN_SECURITY",
      severity: rl.blocked ? "HIGH" : "MEDIUM",
      route: "/api/superadmin/login",
      method: "POST",
      statusCode: 401,
      ipHash,
      userAgent,
      blocked: rl.blocked,
      dedupeKey: `superadmin_failed_login:${ipHash}`,
      metadata: { windowMs: SECURITY_THRESHOLDS.superadminFailedLogin.windowMs },
    });
  }
}
