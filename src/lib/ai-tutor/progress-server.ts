import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { AiTutorialProgressDoc, AiTutorialStatus } from "@/lib/ai-tutor/types";

const SUB = "ai_tutor_progress";

function progressDocId(userId: string, tutorialId: string): string {
  return `${userId}_${tutorialId}`.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export function aiTutorProgressCol(db: Firestore, organizationId: string) {
  return db.collection(COMPANIES_COLLECTION).doc(organizationId).collection(SUB);
}

export async function listAiTutorProgressForUser(
  db: Firestore,
  organizationId: string,
  userId: string
): Promise<AiTutorialProgressDoc[]> {
  const snap = await aiTutorProgressCol(db, organizationId).where("userId", "==", userId).get();
  return snap.docs.map((d) => d.data() as AiTutorialProgressDoc);
}

export async function upsertAiTutorProgress(
  db: Firestore,
  input: {
    organizationId: string;
    userId: string;
    tutorialId: string;
    tutorialVersion: number;
    status: AiTutorialStatus;
    completedSteps?: string[];
    lastStep?: string | null;
  }
): Promise<void> {
  const id = progressDocId(input.userId, input.tutorialId);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    userId: input.userId,
    organizationId: input.organizationId,
    tutorialId: input.tutorialId,
    tutorialVersion: input.tutorialVersion,
    status: input.status,
    completedSteps: input.completedSteps ?? [],
    lastStep: input.lastStep ?? null,
    lastShownAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.status === "completed") patch.completedAt = now;
  if (input.status === "skipped") patch.skippedAt = now;
  await aiTutorProgressCol(db, input.organizationId).doc(id).set(patch, { merge: true });
}
