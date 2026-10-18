import "server-only";

import { randomUUID, createHash } from "crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PLATFORM_MODULE_LAUNCH_TICKETS_COLLECTION } from "@/lib/firestore-collections";

const TTL_MS = 5 * 60 * 1000;

export async function createPortalLaunchTicket(
  db: Firestore,
  payload: {
    organizationId: string;
    organizationName: string;
    userId: string;
    email: string;
    displayName: string;
    moduleCode: string;
  }
): Promise<{ ticketId: string; expiresAt: string }> {
  const ticketId = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await db.collection(PLATFORM_MODULE_LAUNCH_TICKETS_COLLECTION).doc(ticketId).set({
    ...payload,
    used: false,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ticketId, expiresAt };
}

export async function consumePortalLaunchTicket(
  db: Firestore,
  ticketId: string
): Promise<
  | {
      ok: true;
      organizationId: string;
      organizationName: string;
      userId: string;
      email: string;
      displayName: string;
      moduleCode: string;
    }
  | { ok: false; error: string }
> {
  const ref = db.collection(PLATFORM_MODULE_LAUNCH_TICKETS_COLLECTION).doc(ticketId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, error: "Neplatný ticket." };
    const d = snap.data() as Record<string, unknown>;
    if (d.used === true) return { ok: false as const, error: "Ticket již použit." };
    const exp = Date.parse(String(d.expiresAt ?? ""));
    if (!Number.isFinite(exp) || exp < Date.now()) {
      return { ok: false as const, error: "Ticket vypršel." };
    }
    tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
    return {
      ok: true as const,
      organizationId: String(d.organizationId),
      organizationName: String(d.organizationName ?? ""),
      userId: String(d.userId),
      email: String(d.email),
      displayName: String(d.displayName ?? ""),
      moduleCode: String(d.moduleCode),
    };
  });
}

export function hashIntegrationBearer(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
