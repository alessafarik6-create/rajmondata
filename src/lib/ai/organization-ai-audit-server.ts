import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { VerifiedCompanyCaller } from "@/lib/api-company-auth";
import { resolveServerActivityActor } from "@/lib/activity-log-actor-server";
import { parseAiActivityLogSettings } from "@/lib/ai/ai-activity-log-settings";
import { loadAiAssistantSettings } from "@/lib/ai/inquiry-type-rules";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

export type OrganizationAiAuditActionType =
  | "ORG_AI_BRIEFING"
  | "ORG_AI_ASK"
  | "ORG_AI_HOT_TODAY";

function actionLabelCs(actionType: OrganizationAiAuditActionType): string {
  switch (actionType) {
    case "ORG_AI_ASK":
      return "Dotaz na AI asistentku";
    case "ORG_AI_HOT_TODAY":
      return "Přehled důležitého dne (AI)";
    case "ORG_AI_BRIEFING":
    default:
      return "Dotaz na AI asistentku";
  }
}

function safeRequestDocId(requestId: string | null | undefined): string | null {
  const id = String(requestId ?? "").trim();
  if (!id || id.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return id;
}

export async function logOrganizationAiQuerySafe(
  db: Firestore,
  organizationId: string,
  payload: {
    caller: VerifiedCompanyCaller;
    companyData?: Record<string, unknown> | null;
    actionType: OrganizationAiAuditActionType;
    questionText?: string | null;
    moduleHint?: string;
    requestId?: string | null;
    sessionId?: string | null;
    processingMs?: number | null;
    status?: "ok" | "error";
    errorMessage?: string | null;
  }
): Promise<void> {
  try {
    const orgId = String(organizationId ?? "").trim();
    if (!orgId) return;

    const requestDocId = safeRequestDocId(payload.requestId);
    const logsCol = db.collection(COMPANIES_COLLECTION).doc(orgId).collection("activityLogs");
    if (requestDocId) {
      const existing = await logsCol.doc(requestDocId).get();
      if (existing.exists) return;
    }

    const [actor, aiSettings, companySnap] = await Promise.all([
      resolveServerActivityActor(db, payload.caller, payload.companyData ?? null),
      loadAiAssistantSettings(db, orgId),
      payload.companyData
        ? Promise.resolve(null)
        : db.collection(COMPANIES_COLLECTION).doc(orgId).get(),
    ]);

    const companyData =
      payload.companyData ??
      ((companySnap?.exists ? companySnap.data() : null) as Record<string, unknown> | null);
    const organizationName =
      String(companyData?.name ?? companyData?.companyName ?? "").trim() || null;

    const privacy = parseAiActivityLogSettings(aiSettings);
    const questionRaw = String(payload.questionText ?? "").trim();
    const metadata: Record<string, unknown> = {
      aiActionType: payload.actionType,
      organizationName,
      requestId: requestDocId ?? payload.requestId ?? null,
      sessionId: payload.sessionId?.trim() || null,
      processingMs:
        payload.processingMs != null && Number.isFinite(payload.processingMs)
          ? Math.round(payload.processingMs)
          : null,
      status: payload.status ?? "ok",
      role: actor.role,
      roleLabelCs: actor.roleLabelCs,
      firebaseUid: actor.userId,
    };
    if (payload.errorMessage?.trim()) {
      metadata.errorMessage = payload.errorMessage.trim().slice(0, 500);
    }
    if (payload.moduleHint?.trim()) {
      metadata.moduleHint = payload.moduleHint.trim().slice(0, 120);
    }
    if (questionRaw) {
      metadata.queryLength = questionRaw.length;
      if (privacy.storeQueryText) {
        metadata.queryText = questionRaw.slice(0, 2000);
      }
    }

    const details =
      privacy.storeQueryText && questionRaw
        ? questionRaw.slice(0, 400)
        : payload.status === "error" && payload.errorMessage
          ? payload.errorMessage.trim().slice(0, 400)
          : null;

    const docRef = requestDocId ? logsCol.doc(requestDocId) : logsCol.doc();
    await docRef.set({
      organizationId: orgId,
      companyId: orgId,
      userId: actor.userId,
      createdBy: actor.userId,
      employeeId: actor.employeeId,
      employeeName: actor.displayWithRole,
      employeeEmail: actor.employeeEmail,
      actionType: payload.actionType,
      actionLabel: actionLabelCs(payload.actionType),
      entityType: "ai_assistant",
      entityId: payload.sessionId?.trim()?.slice(0, 200) || null,
      entityName: "AI asistentka",
      details,
      sourceModule: "ai_assistant",
      route: "/portal",
      metadata,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit must not break */
  }
}
