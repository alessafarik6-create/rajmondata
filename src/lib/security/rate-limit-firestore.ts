import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { PLATFORM_RATE_LIMITS_COLLECTION } from "@/lib/firestore-collections";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  blocked: boolean;
  count: number;
};

/**
 * Jednoduchý sliding window rate limit v Firestore (funguje napříč instancemi).
 */
export async function checkFirestoreRateLimit(
  db: Firestore,
  key: string,
  opts: { limit: number; windowMs: number }
): Promise<RateLimitResult> {
  const ref = db.collection(PLATFORM_RATE_LIMITS_COLLECTION).doc(key.slice(0, 180));
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart?: number; count?: number } | undefined;
    let windowStart = typeof data?.windowStart === "number" ? data.windowStart : now;
    let count = typeof data?.count === "number" ? data.count : 0;

    if (now - windowStart > opts.windowMs) {
      windowStart = now;
      count = 0;
    }

    count += 1;
    const allowed = count <= opts.limit;
    tx.set(
      ref,
      {
        windowStart,
        count,
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(now + opts.windowMs * 2),
      },
      { merge: true }
    );

    return {
      allowed,
      remaining: Math.max(0, opts.limit - count),
      limit: opts.limit,
      blocked: !allowed,
      count,
    };
  });
}
