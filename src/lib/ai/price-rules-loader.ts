/**
 * Načítání cenových pravidel (Admin SDK).
 */

import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { AI_PRICE_RULES_COLLECTION, type AiPriceRuleDoc } from "@/lib/ai/ai-center-types";

export async function loadActiveAiPriceRules(
  db: Firestore,
  companyId: string
): Promise<AiPriceRuleDoc[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_PRICE_RULES_COLLECTION)
    .where("active", "==", true)
    .limit(200)
    .get();

  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AiPriceRuleDoc, "id">),
  }));
}

export async function loadAllAiPriceRules(
  db: Firestore,
  companyId: string
): Promise<AiPriceRuleDoc[]> {
  const snap = await db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(AI_PRICE_RULES_COLLECTION)
    .limit(300)
    .get();

  return snap.docs
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AiPriceRuleDoc, "id">),
    }))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
