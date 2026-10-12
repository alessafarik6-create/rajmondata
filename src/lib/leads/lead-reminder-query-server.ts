import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";

/** Načte aktivní připomínky splatné k odeslání (s fallbackem bez složeného indexu). */
export async function fetchDueLeadReminderDocs(
  db: Firestore,
  companyId: string,
  limit = 20
): Promise<QueryDocumentSnapshot[]> {
  const col = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION);
  const now = Timestamp.now();

  try {
    const qs = await col
      .where("status", "==", "active")
      .where("notificationFired", "==", false)
      .where("remindAt", "<=", now)
      .orderBy("remindAt", "asc")
      .limit(limit)
      .get();
    return qs.docs;
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;
    console.warn("[lead-reminders] composite index missing, using fallback scan", companyId);
    const qs = await col.where("status", "==", "active").limit(Math.max(limit, 80)).get();
    const nowMs = now.toMillis();
    return qs.docs
      .filter((d) => {
        const data = d.data();
        if (data.notificationFired === true) return false;
        const ra = data.remindAt as Timestamp | undefined;
        const ms = ra?.toMillis?.() ?? NaN;
        return Number.isFinite(ms) && ms <= nowMs;
      })
      .sort((a, b) => {
        const ta = (a.data().remindAt as Timestamp)?.toMillis?.() ?? 0;
        const tb = (b.data().remindAt as Timestamp)?.toMillis?.() ?? 0;
        return ta - tb;
      })
      .slice(0, limit);
  }
}
