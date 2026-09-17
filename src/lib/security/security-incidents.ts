import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  PLATFORM_SECURITY_ALERT_STATE_COLLECTION,
  PLATFORM_SECURITY_DAILY_COLLECTION,
  PLATFORM_SECURITY_INCIDENTS_COLLECTION,
} from "@/lib/firestore-collections";
import { loadPlatformProviderContactEmail } from "@/lib/platform-admin-notifications/provider-email";
import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";
import { resolveAppBaseUrl } from "@/lib/password-reset-link";
import {
  SECURITY_ALERT_EMAIL_COOLDOWN_MS,
  type SecurityCategory,
  type SecuritySeverity,
} from "@/lib/security/security-config";
import { sanitizeSecurityMetadata, truncateUserAgent } from "@/lib/security/sanitize-metadata";

export type RecordSecurityIncidentInput = {
  type: string;
  category: SecurityCategory;
  severity: SecuritySeverity;
  route?: string;
  method?: string;
  statusCode?: number;
  source?: string;
  ipHash?: string;
  userAgent?: string;
  country?: string;
  blocked?: boolean;
  metadata?: Record<string, unknown>;
  /** Agregační klíč — stejný útok = jeden dokument. */
  dedupeKey: string;
  testMode?: boolean;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function incidentDocId(dedupeKey: string): string {
  const safe = dedupeKey.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120);
  return safe || `inc_${Date.now()}`;
}

async function bumpDailySecurity(
  db: Firestore,
  patch: {
    events?: number;
    blocked?: number;
    failedLogin?: number;
    rateLimits?: number;
    high?: number;
    critical?: number;
  }
) {
  const ref = db.collection(PLATFORM_SECURITY_DAILY_COLLECTION).doc(todayKey());
  const inc: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (patch.events) inc.events = FieldValue.increment(patch.events);
  if (patch.blocked) inc.blocked = FieldValue.increment(patch.blocked);
  if (patch.failedLogin) inc.failedLogin = FieldValue.increment(patch.failedLogin);
  if (patch.rateLimits) inc.rateLimits = FieldValue.increment(patch.rateLimits);
  if (patch.high) inc.high = FieldValue.increment(patch.high);
  if (patch.critical) inc.critical = FieldValue.increment(patch.critical);
  await ref.set(inc, { merge: true });
}

async function maybeSendSecurityEmail(
  db: Firestore,
  incidentId: string,
  input: RecordSecurityIncidentInput,
  eventCount: number
) {
  if (input.testMode) return { emailSent: false, emailSkipped: true };
  if (input.severity !== "HIGH" && input.severity !== "CRITICAL") {
    return { emailSent: false, emailSkipped: true };
  }

  const stateRef = db.collection(PLATFORM_SECURITY_ALERT_STATE_COLLECTION).doc(incidentId);
  const stateSnap = await stateRef.get();
  const lastEmailAt = stateSnap.data()?.lastEmailAt as { toMillis?: () => number } | undefined;
  const lastMs =
    lastEmailAt && typeof lastEmailAt.toMillis === "function" ? lastEmailAt.toMillis() : 0;
  if (Date.now() - lastMs < SECURITY_ALERT_EMAIL_COOLDOWN_MS) {
    return { emailSent: false, emailSkipped: true, reason: "cooldown" };
  }

  const providerEmail = await loadPlatformProviderContactEmail(db);
  if (!providerEmail) {
    return { emailSent: false, emailSkipped: true, reason: "no_provider_email" };
  }

  const isCritical = input.severity === "CRITICAL";
  const subject = isCritical
    ? "🔴 RAJMONDATA – kritické bezpečnostní upozornění"
    : "⚠ RAJMONDATA – bezpečnostní upozornění";

  const base = resolveAppBaseUrl();
  const html = buildNotificationHtml({
    moduleLabel: "RAJMONDATA Security",
    title: isCritical ? "Kritická bezpečnostní událost" : "Bezpečnostní upozornění",
    companyName: "Provozovatel platformy",
    lines: [
      `Čas: ${new Date().toLocaleString("cs-CZ")}`,
      `Závažnost: ${input.severity}`,
      `Typ: ${input.type}`,
      `Endpoint: ${input.route || "—"}`,
      `Počet: ${eventCount}`,
      `Akce: ${input.blocked ? "Rate limit / blokace aktivní" : "Monitorováno"}`,
      `Incident ID: ${incidentId}`,
    ],
    actionUrl: `${base}/admin/security`,
  });

  const send = await sendTransactionalEmail({ to: [providerEmail], subject, html });
  if (send.ok) {
    await stateRef.set({ lastEmailAt: FieldValue.serverTimestamp() }, { merge: true });
    return { emailSent: true };
  }
  return { emailSent: false, emailError: send.error };
}

async function createAdminSecurityNotification(
  db: Firestore,
  incidentId: string,
  input: RecordSecurityIncidentInput,
  eventCount: number
) {
  if (input.testMode) return;
  const { PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION } = await import("@/lib/firestore-collections");
  const title =
    input.severity === "CRITICAL"
      ? "Kritické bezpečnostní upozornění"
      : "Bezpečnostní upozornění";
  const message = `${input.type} — ${eventCount} událostí (${input.route || "—"})`;
  await db.collection(PLATFORM_ADMIN_NOTIFICATIONS_COLLECTION).doc(`sec_${incidentId}`).set(
    {
      type: "SECURITY_ALERT",
      title,
      message,
      organizationId: null,
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      metadata: {
        incidentId,
        severity: input.severity,
        category: input.category,
        route: input.route ?? null,
        eventCount,
      },
    },
    { merge: true }
  );
}

/**
 * Agregovaný zápis — jeden incident na dedupeKey, zvyšuje eventCount.
 */
export async function recordSecurityIncident(
  db: Firestore,
  input: RecordSecurityIncidentInput
): Promise<{ incidentId: string; eventCount: number; created: boolean }> {
  const id = incidentDocId(input.dedupeKey);
  const ref = db.collection(PLATFORM_SECURITY_INCIDENTS_COLLECTION).doc(id);
  const now = FieldValue.serverTimestamp();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, {
        type: input.type,
        category: input.category,
        severity: input.severity,
        route: input.route ?? null,
        method: input.method ?? null,
        statusCode: input.statusCode ?? null,
        source: input.source ?? null,
        ipHash: input.ipHash ?? null,
        userAgent: input.userAgent ? truncateUserAgent(input.userAgent) : null,
        country: input.country ?? null,
        blocked: !!input.blocked,
        metadata: sanitizeSecurityMetadata(input.metadata ?? {}),
        eventCount: 1,
        dedupeKey: input.dedupeKey,
        testMode: !!input.testMode,
        createdAt: now,
        lastActivityAt: now,
        resolvedAt: null,
        resolvedBy: null,
      });
      return { eventCount: 1, created: true };
    }
    const prev = snap.data()?.eventCount;
    const eventCount = (typeof prev === "number" ? prev : 0) + 1;
    tx.update(ref, {
      eventCount,
      lastActivityAt: now,
      severity: input.severity,
      blocked: input.blocked ?? snap.data()?.blocked,
    });
    return { eventCount, created: false };
  });

  await bumpDailySecurity(db, {
    events: 1,
    blocked: input.blocked ? 1 : 0,
    failedLogin: input.type.includes("FAILED_LOGIN") ? 1 : 0,
    rateLimits: input.blocked ? 1 : 0,
    high: input.severity === "HIGH" ? 1 : 0,
    critical: input.severity === "CRITICAL" ? 1 : 0,
  });

  if (result.created && (input.severity === "HIGH" || input.severity === "CRITICAL")) {
    await createAdminSecurityNotification(db, id, input, result.eventCount);
    await maybeSendSecurityEmail(db, id, input, result.eventCount);
  } else if (
    !result.created &&
    result.eventCount === 10 &&
    (input.severity === "HIGH" || input.severity === "CRITICAL")
  ) {
    // Eskalace při růstu — druhý email až po cooldownu
    await maybeSendSecurityEmail(db, id, input, result.eventCount);
  }

  return { incidentId: id, ...result };
}

export async function writeSecurityAudit(
  db: Firestore,
  entry: {
    action: string;
    actor: string;
    metadata?: Record<string, unknown>;
  }
) {
  const { PLATFORM_SECURITY_AUDIT_COLLECTION } = await import("@/lib/firestore-collections");
  await db.collection(PLATFORM_SECURITY_AUDIT_COLLECTION).add({
    action: entry.action,
    actor: entry.actor,
    metadata: sanitizeSecurityMetadata(entry.metadata ?? {}),
    createdAt: FieldValue.serverTimestamp(),
  });
}
