import type { Firestore } from "firebase-admin/firestore";
import { verifyAttendancePinForEmployee } from "@/lib/attendance-pin-server";
import { checkFirestoreRateLimit } from "@/lib/security/rate-limit-firestore";
import { recordSecurityIncident } from "@/lib/security/security-incidents";
import { createHash } from "crypto";

const PIN_LIMIT = 8;
const PIN_WINDOW_MS = 15 * 60 * 1000;

export function hashClientIp(ip: string): string {
  return createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 24);
}

export async function verifyProductionQrPin(
  db: Firestore,
  opts: {
    companyId: string;
    employeeId: string;
    pinNormalized: string;
    ip?: string;
    route: string;
  }
): Promise<{ ok: true } | { ok: false; status: number; error: string; rateLimited?: boolean }> {
  const ipHash = hashClientIp(opts.ip ?? "");
  const rlEmp = await checkFirestoreRateLimit(
    db,
    `prod_qr_pin:${opts.companyId}:${opts.employeeId}`,
    { limit: PIN_LIMIT, windowMs: PIN_WINDOW_MS }
  );
  const rlIp = await checkFirestoreRateLimit(db, `prod_qr_pin_ip:${ipHash}`, {
    limit: PIN_LIMIT * 3,
    windowMs: PIN_WINDOW_MS,
  });

  if (!rlEmp.allowed || !rlIp.allowed) {
    await recordSecurityIncident(db, {
      type: "PRODUCTION_QR_PIN_RATE_LIMIT",
      category: "AUTH_SECURITY",
      severity: "MEDIUM",
      route: opts.route,
      method: "POST",
      statusCode: 429,
      ipHash,
      blocked: true,
      dedupeKey: `prod_qr_rl:${opts.companyId}:${opts.employeeId}`,
      metadata: { employeeId: opts.employeeId },
    });
    return {
      ok: false,
      status: 429,
      error: "Příliš mnoho pokusů. Zkuste to za chvíli.",
      rateLimited: true,
    };
  }

  const pinOk = await verifyAttendancePinForEmployee(
    db,
    opts.companyId,
    opts.employeeId,
    opts.pinNormalized
  );
  if (!pinOk) {
    await recordSecurityIncident(db, {
      type: "PRODUCTION_QR_PIN_FAIL",
      category: "AUTH_SECURITY",
      severity: rlEmp.count >= 5 ? "MEDIUM" : "LOW",
      route: opts.route,
      method: "POST",
      statusCode: 401,
      ipHash,
      blocked: false,
      dedupeKey: `prod_qr_fail:${opts.companyId}:${opts.employeeId}:${Math.floor(Date.now() / 600_000)}`,
      metadata: { employeeId: opts.employeeId },
    });
    return { ok: false, status: 401, error: "Neplatný PIN." };
  }

  return { ok: true };
}
