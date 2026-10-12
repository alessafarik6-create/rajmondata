import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  COMPANIES_COLLECTION,
  LEAD_REMINDERS_SUBCOLLECTION,
} from "@/lib/firestore-collections";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";

function sortByRemindAtDesc(docs: QueryDocumentSnapshot[]): QueryDocumentSnapshot[] {
  return [...docs].sort((a, b) => {
    const ta = (a.data().remindAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const tb = (b.data().remindAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    return tb - ta;
  });
}

export async function listLeadReminderDocs(
  db: Firestore,
  companyId: string,
  opts: { leadKey?: string; assignedUserId?: string; limit: number }
): Promise<QueryDocumentSnapshot[]> {
  const col = db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(LEAD_REMINDERS_SUBCOLLECTION);
  const limit = opts.limit;

  try {
    if (opts.leadKey) {
      const qs = await col
        .where("leadKey", "==", opts.leadKey)
        .orderBy("remindAt", "desc")
        .limit(limit)
        .get();
      return qs.docs;
    }
    if (opts.assignedUserId) {
      const qs = await col
        .where("assignedUserId", "==", opts.assignedUserId)
        .orderBy("remindAt", "desc")
        .limit(limit)
        .get();
      return qs.docs;
    }
    const qs = await col.orderBy("remindAt", "desc").limit(limit).get();
    return qs.docs;
  } catch (err) {
    if (!isFirestoreIndexError(err)) throw err;
    let qs;
    if (opts.leadKey) {
      qs = await col.where("leadKey", "==", opts.leadKey).limit(Math.max(limit, 100)).get();
    } else if (opts.assignedUserId) {
      qs = await col.where("assignedUserId", "==", opts.assignedUserId).limit(Math.max(limit, 100)).get();
    } else {
      qs = await col.limit(Math.max(limit, 150)).get();
    }
    return sortByRemindAtDesc(qs.docs).slice(0, limit);
  }
}
