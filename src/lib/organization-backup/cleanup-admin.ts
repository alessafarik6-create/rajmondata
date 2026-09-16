import type { Firestore } from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminBackupStorageBucket } from "@/lib/firebase-admin";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { ORGANIZATION_BACKUPS_SUBCOLLECTION } from "@/lib/organization-backup/constants";
import { computePendingDeletionPurgeAt } from "@/lib/organization-backup/retention";

export async function purgeExpiredOrganizationBackupsAdmin(
  db: Firestore
): Promise<{ deleted: number; errors: number }> {
  const now = Timestamp.now();
  let deleted = 0;
  let errors = 0;
  const bucket = getAdminBackupStorageBucket();

  const companiesSnap = await db.collection(COMPANIES_COLLECTION).select().get();
  for (const companyDoc of companiesSnap.docs) {
    const orgId = companyDoc.id;
    const backupsRef = db
      .collection(COMPANIES_COLLECTION)
      .doc(orgId)
      .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION);

    const expiredSnap = await backupsRef.where("expiresAt", "<=", now).limit(50).get();
    const pendingSnap = await backupsRef.where("status", "==", "PENDING_DELETION").limit(50).get();

    const toDelete = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const d of [...expiredSnap.docs, ...pendingSnap.docs]) {
      toDelete.set(d.id, d);
    }

    for (const docSnap of toDelete.values()) {
      const data = docSnap.data() as {
        pendingDeletionAt?: FirebaseFirestore.Timestamp;
        storagePath?: string;
      };
      if (data.pendingDeletionAt) {
        const purgeAt = computePendingDeletionPurgeAt(data.pendingDeletionAt.toDate());
        if (purgeAt.getTime() > Date.now()) continue;
      }

      const storagePath = String(data.storagePath ?? "").trim();
      try {
        if (bucket && storagePath) {
          await bucket.deleteFiles({ prefix: `${storagePath}/` });
        }
        await docSnap.ref.delete();
        deleted += 1;
      } catch (e) {
        errors += 1;
        console.error("[backup purge]", orgId, docSnap.id, (e as Error)?.message);
      }
    }
  }

  return { deleted, errors };
}

export async function markOrganizationBackupForDeletion(
  db: Firestore,
  organizationId: string,
  backupId: string
): Promise<void> {
  const ref = db
    .collection(COMPANIES_COLLECTION)
    .doc(organizationId)
    .collection(ORGANIZATION_BACKUPS_SUBCOLLECTION)
    .doc(backupId);
  await ref.update({
    status: "PENDING_DELETION",
    pendingDeletionAt: FieldValue.serverTimestamp(),
  });
}
