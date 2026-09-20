/**
 * E-mail → Automatizace — architektura pravidel (postupné doplňování akcí).
 * Automatizace NIKDY neposílá e-mail ani nemění spam bez explicitního pravidla + povolení.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { EmailMessageDoc } from "@/lib/email-mailbox/types";
import {
  EMAIL_SUBCOLLECTION_AUTOMATION_RULES,
  EMAIL_SUBCOLLECTION_AUTOMATION_RUNS,
  normalizeAiCategory,
  type EmailAutomationRuleDoc,
} from "@/lib/email-mailbox/intelligence-types";

export function automationRulesCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(EMAIL_SUBCOLLECTION_AUTOMATION_RULES);
}

export function automationRunsCol(db: Firestore, companyId: string) {
  return db
    .collection(COMPANIES_COLLECTION)
    .doc(companyId)
    .collection(EMAIL_SUBCOLLECTION_AUTOMATION_RUNS);
}

export type AutomationMatchContext = {
  message: EmailMessageDoc;
  mailboxEmail?: string | null;
};

function ruleMatches(rule: EmailAutomationRuleDoc, ctx: AutomationMatchContext): boolean {
  if (!rule.enabled) return false;
  const cond = rule.conditions ?? {};
  const cat = normalizeAiCategory(ctx.message.aiCategory ?? ctx.message.aiClassification);
  if (cond.aiCategory && String(cond.aiCategory).toUpperCase() !== cat) return false;
  if (cond.toMailbox && ctx.mailboxEmail) {
    const want = String(cond.toMailbox).trim().toLowerCase();
    if (ctx.mailboxEmail.toLowerCase() !== want) return false;
  }
  if (cond.requiresReply === true && !ctx.message.needsReply) return false;
  return true;
}

/** Spustí pravidla — zatím pouze log run + návrh akcí (bez side-effectů). */
export async function runEmailAutomationForMessage(
  db: Firestore,
  companyId: string,
  ctx: AutomationMatchContext
): Promise<{ matched: number }> {
  const snap = await automationRulesCol(db, companyId).where("enabled", "==", true).limit(20).get();
  let matched = 0;
  for (const doc of snap.docs) {
    const rule = doc.data() as EmailAutomationRuleDoc;
    if (!ruleMatches(rule, ctx)) continue;
    matched++;
    await automationRunsCol(db, companyId).add({
      organizationId: companyId,
      ruleId: doc.id,
      messageId: ctx.message.messageId ?? null,
      emailAccountId: ctx.message.emailAccountId,
      status: "planned",
      actions: rule.actions ?? [],
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { matched };
}
