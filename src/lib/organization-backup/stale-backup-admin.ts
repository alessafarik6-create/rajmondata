import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import { logBackupEvent } from "@/lib/organization-backup/backup-log";

/** Záloha bez pokroku déle než N ms → FAILED. */
export const BACKUP_STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

export async function markStaleOrganizationBackupsFailed(
  db: Firestore,
  now = Date.now()
): Promise<number> {
  let marked = 0;
  const companies = await db.collection(COMPANIES_COLLECTION).select().limit(500).get();
  const cutoff = Timestamp.fromMillis(now - BACKUP_STALE_RUNNING_MS);

  for (const company of companies.docs) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(company.id)
      .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
      .where("status", "in", ["CREATING", "VERIFYING", "RESTORING"])
      .limit(30)
      .get()
      .catch(() => null);
    if (!snap) continue;

    for (const doc of snap.docs) {
      const d = doc.data() as { createdAt?: Timestamp; startedAt?: Timestamp };
      const started = d.startedAt ?? d.createdAt;
      if (!started || started.toMillis() > cutoff.toMillis()) continue;

      await doc.ref.update({
        status: "FAILED",
        error: "Záloha překročila časový limit (visící job). Spusťte novou zálohu nebo Pokračovat.",
        completedAt: FieldValue.serverTimestamp(),
      });
      marked += 1;
      logBackupEvent("BACKUP_STALE_MARKED_FAILED", {
        organizationId: company.id,
        backupId: doc.id,
      });
    }
  }
  return marked;
}
