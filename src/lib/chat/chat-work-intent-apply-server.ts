import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type {
  ChatWorkIntentApplyResult,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";
import type { ChatWorkIntentApplyDraftsByProposal } from "@/lib/chat/chat-work-intent-apply-types";
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
import {
  addJobNoteCommentAdmin,
  assignEmployeesToJobAdmin,
} from "@/lib/chat/chat-work-intent-job-admin";
import { buildJobAssignmentMessageText } from "@/lib/chat/chat-work-intent-notify-message";
import { sendJobAssignmentChatAndNotification } from "@/lib/chat/chat-work-intent-notify-server";

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

async function findCustomerByEmailOrPhone(
  db: Firestore,
  companyId: string,
  email: string,
  phone: string
): Promise<string | null> {
  const em = email.trim().toLowerCase();
  const ph = phone.replace(/\D/g, "");
  if (em) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .where("email", "==", em)
      .limit(1)
      .get()
      .catch(() => null);
    if (snap?.docs[0]) return snap.docs[0].id;
  }
  if (ph.length >= 9) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .limit(300)
      .get();
    for (const d of snap.docs) {
      const p = String(d.data().phone ?? "").replace(/\D/g, "");
      if (p === ph) return d.id;
    }
  }
  return null;
}

async function resolveCustomerId(
  db: Firestore,
  companyId: string,
  p: ChatWorkIntentProposal,
  draft: ChatWorkIntentApplyDraftsByProposal[string] | undefined,
  createIfMissing: boolean,
  createdBy: string
): Promise<{ customerId: string | null; customerName: string; error?: string }> {
  const draftCustomerId = String(draft?.customerId ?? "").trim();
  if (draftCustomerId) {
    const snap = await db
      .collection(COMPANIES_COLLECTION)
      .doc(companyId)
      .collection("customers")
      .doc(draftCustomerId)
      .get();
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown>;
      const name = String(data.companyName ?? data.name ?? draft?.customerName ?? "").trim();
      return { customerId: draftCustomerId, customerName: name || customerDisplayName(p) };
    }
  }

  if (p.customerMatch?.customerId) {
    return {
      customerId: p.customerMatch.customerId,
      customerName: p.customerMatch.label || customerDisplayName(p),
    };
  }

  const name = String(draft?.customerName ?? "").trim() || customerDisplayName(p);
  const email = String(draft?.email ?? p.email ?? "").trim();
  const phone = String(draft?.phone ?? p.phone ?? "").trim();
  const address = String(draft?.address ?? p.address ?? "").trim();

  const existing = await findCustomerByEmailOrPhone(db, companyId, email, phone);
  if (existing) {
    return { customerId: existing, customerName: name };
  }

  if (!createIfMissing && !draft?.createNewCustomer) {
    return { customerId: null, customerName: name, error: "Vyberte zákazníka nebo doplňte údaje." };
  }

  const emailErr = validateCustomerEmail(email);
  const phoneErr = validateCustomerPhone(phone);
  if (!name || emailErr || phoneErr || !address) {
    return {
      customerId: null,
      customerName: name,
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
  return { customerId: ref.id, customerName: name };
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
  messageId?: string;
  sourceAttachmentId?: string | null;
  proposals: ChatWorkIntentProposal[];
  selectedProposalIds: string[];
  draftsByProposalId?: ChatWorkIntentApplyDraftsByProposal;
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

  const drafts = input.draftsByProposalId ?? {};
  const notificationsSent = new Set<string>();
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

    const draftEarly = drafts[p.proposalId];
    if (p.completionStatus === "needs_input" && p.kind === "new_job") {
      const hasCustomer =
        Boolean(draftEarly?.customerId?.trim()) ||
        Boolean(
          draftEarly?.createNewCustomer &&
            draftEarly.customerName?.trim() &&
            draftEarly.email?.trim() &&
            draftEarly.phone?.trim() &&
            draftEarly.address?.trim()
        );
      if (!hasCustomer) {
        results.push({
          proposalId: p.proposalId,
          kind: p.kind,
          ok: false,
          error: `Doplňte: ${(p.missingFields ?? []).join(", ")}`,
        });
        continue;
      }
    }

    try {
      if (p.kind === "new_job") {
        const draft = drafts[p.proposalId];
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

        const title = String(draft?.jobTitle ?? p.jobTitle ?? "").trim();
        if (!title) {
          results.push({
            proposalId: p.proposalId,
            kind: p.kind,
            ok: false,
            error: "Chybí název zakázky.",
          });
          continue;
        }

        const { customerId, customerName, error: custErr } = await resolveCustomerId(
          input.db,
          input.companyId,
          p,
          draft,
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

        const startDate = String(draft?.scheduledDate ?? p.scheduledDate ?? "").trim();
        const endDate = String(draft?.scheduledEndDate ?? p.scheduledEndDate ?? "").trim();
        const note = String(draft?.note ?? p.description ?? "").trim();
        const payload: Record<string, unknown> = {
          name: title,
          description: String(p.description ?? p.sourceQuote ?? "").trim(),
          status: "nová",
          companyId: input.companyId,
          customerId: customerId ?? null,
          customerName,
          customerPhone: String(draft?.phone ?? p.phone ?? ""),
          customerEmail: String(draft?.email ?? p.email ?? ""),
          assignedEmployeeIds: [input.callerUid],
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: input.callerUid,
          createdByName: input.callerName,
          sourceChatAnalysisId: input.analysisId,
          sourceChatMessageId: input.messageId ?? null,
          sourceChatAttachmentId: input.sourceAttachmentId ?? null,
          internalNoteFromChatAi: note || null,
        };
        if (jobNumber) {
          payload.jobNumber = jobNumber;
          payload.orderNumber = jobNumber;
        }
        if (typeId) payload.jobNumberTypeId = typeId;
        if (startDate) payload.startDate = startDate;
        if (endDate) payload.endDate = endDate;

        const jobRef = await input.db
          .collection(COMPANIES_COLLECTION)
          .doc(input.companyId)
          .collection("jobs")
          .add(payload);

        const employeeIds = (draft?.assignedEmployeeIds ?? []).map(String).filter(Boolean);
        let assignedEmployees: Array<{ employeeId: string; authUserId: string | null }> = [];
        if (employeeIds.length) {
          assignedEmployees = await assignEmployeesToJobAdmin(
            input.db,
            input.companyId,
            jobRef.id,
            payload,
            employeeIds,
            input.callerUid
          );
          const invitedAt = new Date().toISOString();
          const responsePatch: Record<string, unknown> = {
            updatedAt: FieldValue.serverTimestamp(),
          };
          for (const row of assignedEmployees) {
            responsePatch[`employeeAssignmentResponses.${row.employeeId}`] = {
              employeeId: row.employeeId,
              authUserId: row.authUserId,
              status: "pending",
              invitedAt,
              invitedByUid: input.callerUid,
              invitedByName: input.callerName,
            };
          }
          if (Object.keys(responsePatch).length > 1) {
            await jobRef.update(responsePatch);
          }
        }

        if (note) {
          await addJobNoteCommentAdmin(
            input.db,
            input.companyId,
            jobRef.id,
            note,
            input.callerUid,
            input.callerName,
            input.callerRole
          );
        }

        const notify = draft?.notifyEmployee !== false;
        if (notify && assignedEmployees.length) {
          const msgText = buildJobAssignmentMessageText({
            jobNumber: jobNumber ?? null,
            jobName: title,
            customerName,
            startDate: startDate || null,
            endDate: endDate || null,
            note,
            assignerLabel: input.callerName,
          });
          for (const row of assignedEmployees) {
            const authUid = String(row.authUserId ?? "").trim();
            if (!authUid) continue;
            const nKey = `${p.proposalId}:${row.employeeId}:${jobRef.id}`;
            if (notificationsSent.has(nKey)) continue;
            notificationsSent.add(nKey);
            const sent = await sendJobAssignmentChatAndNotification({
              db: input.db,
              companyId: input.companyId,
              adminUid: input.callerUid,
              adminName: input.callerName,
              employeeAuthUserId: authUid,
              employeeDocId: row.employeeId,
              jobId: jobRef.id,
              jobName: title,
              messageText: msgText,
              eventKey: `${input.idempotencyKey}:${nKey}`,
            });
            if (sent.chatMessageId) {
              await jobRef.update({
                [`employeeAssignmentResponses.${row.employeeId}.chatMessageId`]:
                  sent.chatMessageId,
              });
            }
          }
        }

        results.push({
          proposalId: p.proposalId,
          kind: p.kind,
          ok: true,
          jobId: jobRef.id,
          jobName: title,
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
    notificationsSent: [...notificationsSent],
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.callerUid,
  });

  return { results, duplicate: false };
}
