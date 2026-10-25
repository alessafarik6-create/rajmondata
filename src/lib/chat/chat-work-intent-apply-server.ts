import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type {
  ChatWorkIntentApplyResult,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";
import {
  validateCustomerEmail,
  validateCustomerPhone,
} from "@/lib/job-create-customer-validation";
import { allocateJobNumberAdmin } from "@/lib/jobs/job-numbering-server";
import { createOrganizationTask } from "@/lib/tasks/create-organization-task-server";
import {
  createOrganizationCalendarMeeting,
  type CalendarMeetingDraft,
} from "@/lib/calendar/create-organization-meeting-server";

function customerDisplayName(p: ChatWorkIntentProposal): string {
  return (
    String(p.companyName ?? "").trim() ||
    String(p.customerName ?? "").trim() ||
    "Zákazník"
  );
}

function jobTitleFromProposal(p: ChatWorkIntentProposal): string {
  const t = String(p.jobTitle ?? "").trim();
  if (t) return t;
  const cust = customerDisplayName(p);
  return `Zakázka — ${cust}`;
}

async function resolveCustomerId(
  db: Firestore,
  companyId: string,
  p: ChatWorkIntentProposal,
  createIfMissing: boolean,
  createdBy: string
): Promise<{ customerId: string | null; error?: string }> {
  if (p.customerMatch?.customerId) {
    return { customerId: p.customerMatch.customerId };
  }
  if (!createIfMissing) return { customerId: null };

  const name = customerDisplayName(p);
  const email = String(p.email ?? "").trim();
  const phone = String(p.phone ?? "").trim();
  const address = String(p.address ?? "").trim();
  const emailErr = validateCustomerEmail(email);
  const phoneErr = validateCustomerPhone(phone);
  if (!name || emailErr || phoneErr || !address) {
    return {
      customerId: null,
      error: "Pro nového zákazníka chybí povinné údaje (jméno, e-mail, telefon, adresa).",
    };
  }

  const ref = await db.collection(COMPANIES_COLLECTION).doc(companyId).collection("customers").add({
    companyName: name,
    email,
    phone,
    address,
    companyId,
    organizationId: companyId,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { customerId: ref.id };
}

export async function applyChatWorkIntentProposals(input: {
  db: Firestore;
  companyId: string;
  callerUid: string;
  callerName: string;
  callerRole: string;
  timeZone: string;
  idempotencyKey: string;
  analysisId: string;
  proposals: ChatWorkIntentProposal[];
  selectedProposalIds: string[];
  options?: {
    createMissingCustomers?: boolean;
    linkJobIdByProposal?: Record<string, string>;
  };
}): Promise<{ results: ChatWorkIntentApplyResult[]; duplicate: boolean }> {
  const idemRef = input.db
    .collection(COMPANIES_COLLECTION)
    .doc(input.companyId)
    .collection("chatWorkIntentApplies")
    .doc(input.idempotencyKey.slice(0, 120));

  const idemSnap = await idemRef.get();
  if (idemSnap.exists) {
    const prev = idemSnap.data()?.results;
    return {
      duplicate: true,
      results: Array.isArray(prev) ? (prev as ChatWorkIntentApplyResult[]) : [],
    };
  }

  const selected = new Set(input.selectedProposalIds);
  const toApply = input.proposals.filter((p) => selected.has(p.proposalId));
  const results: ChatWorkIntentApplyResult[] = [];

  for (const p of toApply) {
    if (p.kind === "unclear") {
      results.push({
        proposalId: p.proposalId,
        kind: p.kind,
        ok: false,
        error: "Nejasný typ — vyberte akci ručně.",
      });
      continue;
    }

    if (p.completionStatus === "needs_input" && p.kind === "new_job") {
      results.push({
        proposalId: p.proposalId,
        kind: p.kind,
        ok: false,
        error: `Doplňte: ${(p.missingFields ?? []).join(", ")}`,
      });
      continue;
    }

    try {
      if (p.kind === "new_job") {
        const linkId = input.options?.linkJobIdByProposal?.[p.proposalId];
        if (linkId) {
          results.push({
            proposalId: p.proposalId,
            kind: p.kind,
            ok: true,
            jobId: linkId,
            jobName: jobTitleFromProposal(p),
          });
          continue;
        }

        const { customerId, error: custErr } = await resolveCustomerId(
          input.db,
          input.companyId,
          p,
          input.options?.createMissingCustomers !== false,
          input.callerUid
        );
        if (custErr) {
          results.push({ proposalId: p.proposalId, kind: p.kind, ok: false, error: custErr });
          continue;
        }

        let jobNumber: string | undefined;
        let typeId: string | undefined;
        try {
          const num = await allocateJobNumberAdmin(input.db, input.companyId, null);
          jobNumber = num.jobNumber;
          typeId = num.typeId;
        } catch {
          /* optional */
        }

        const name = jobTitleFromProposal(p);
        const payload: Record<string, unknown> = {
          name,
          description: String(p.description ?? p.sourceQuote ?? "").trim(),
          status: "nová",
          companyId: input.companyId,
          customerId: customerId ?? null,
          customerName: customerDisplayName(p),
          customerPhone: p.phone ?? "",
          customerEmail: p.email ?? "",
          assignedEmployeeIds: [input.callerUid],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: input.callerUid,
          sourceChatAnalysisId: input.analysisId,
        };
        if (jobNumber) {
          payload.jobNumber = jobNumber;
          payload.orderNumber = jobNumber;
        }
        if (typeId) payload.jobNumberTypeId = typeId;
        if (p.scheduledDate) payload.startDate = p.scheduledDate;
        if (p.scheduledEndDate) payload.endDate = p.scheduledEndDate;

        const jobRef = await input.db
          .collection(COMPANIES_COLLECTION)
          .doc(input.companyId)
          .collection("jobs")
          .add(payload);

        results.push({
          proposalId: p.proposalId,
          kind: p.kind,
          ok: true,
          jobId: jobRef.id,
          jobName: name,
          customerId: customerId ?? undefined,
        });
        continue;
      }

      if (p.kind === "task") {
        const { taskId } = await createOrganizationTask(input.db, {
          companyId: input.companyId,
          createdByUserId: input.callerUid,
          createdVia: "chat_ai",
          draft: {
            title: jobTitleFromProposal(p),
            description: String(p.description ?? p.sourceQuote ?? "").trim(),
            dueDate: p.scheduledDate,
            priority: "medium",
            jobId: p.jobMatches?.[0]?.jobId ?? null,
            jobName: p.jobMatches?.[0]?.name ?? null,
          },
        });
        results.push({ proposalId: p.proposalId, kind: p.kind, ok: true, taskId });
        continue;
      }

      if (p.kind === "meeting") {
        const date = String(p.scheduledDate ?? "").trim();
        const time = String(p.scheduledTime ?? "09:00").trim() || "09:00";
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          results.push({
            proposalId: p.proposalId,
            kind: p.kind,
            ok: false,
            error: "Schůzka vyžaduje potvrzené datum (YYYY-MM-DD).",
          });
          continue;
        }
        const draft: CalendarMeetingDraft = {
          title: jobTitleFromProposal(p),
          date,
          startTime: time.length >= 4 ? time.slice(0, 5) : "09:00",
          customerName: customerDisplayName(p),
          place: p.address ?? "",
          note: String(p.description ?? "").trim(),
          phone: p.phone ?? "",
          calendarEventType: "meeting",
          assignedUserIds: [input.callerUid],
          jobId: p.jobMatches?.[0]?.jobId ?? null,
          jobName: p.jobMatches?.[0]?.name ?? null,
          customerId: p.customerMatch?.customerId ?? null,
        };
        const { eventId } = await createOrganizationCalendarMeeting(input.db, {
          companyId: input.companyId,
          draft,
          timeZone: input.timeZone,
          createdByUserId: input.callerUid,
          createdByName: input.callerName,
          createdByRole: input.callerRole,
          createdVia: "chat_ai",
        });
        results.push({ proposalId: p.proposalId, kind: p.kind, ok: true, eventId });
        continue;
      }

      if (p.kind === "note_to_job") {
        const jobId =
          input.options?.linkJobIdByProposal?.[p.proposalId] ??
          p.jobMatches?.[0]?.jobId ??
          null;
        if (!jobId) {
          results.push({
            proposalId: p.proposalId,
            kind: p.kind,
            ok: false,
            error: "Vyberte existující zakázku pro poznámku.",
          });
          continue;
        }
        const text = String(p.description ?? p.sourceQuote ?? p.jobTitle ?? "").trim();
        const commentRef = await input.db
          .collection(COMPANIES_COLLECTION)
          .doc(input.companyId)
          .collection("jobs")
          .doc(jobId)
          .collection("comments")
          .add({
            organizationId: input.companyId,
            jobId,
            targetType: "job",
            message: text || "Poznámka z chatu (AI)",
            authorId: input.callerUid,
            authorName: input.callerName,
            authorRole: ["owner", "admin", "manager"].includes(input.callerRole)
              ? "admin"
              : "employee",
            createdAt: FieldValue.serverTimestamp(),
            readBy: [input.callerUid],
          });
        results.push({
          proposalId: p.proposalId,
          kind: p.kind,
          ok: true,
          jobId,
          commentId: commentRef.id,
        });
        continue;
      }

      results.push({
        proposalId: p.proposalId,
        kind: p.kind,
        ok: false,
        error: "Nepodporovaný typ návrhu.",
      });
    } catch (e) {
      results.push({
        proposalId: p.proposalId,
        kind: p.kind,
        ok: false,
        error: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    }
  }

  await idemRef.set({
    analysisId: input.analysisId,
    idempotencyKey: input.idempotencyKey,
    results,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.callerUid,
  });

  return { results, duplicate: false };
}
