import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { MAIL_DISPATCH_QUEUE } from "@/lib/email-notifications/dispatch";
import { createNotification } from "@/lib/notification-service/notification-service";
import {
  buildSupportReplyEmailHtml,
  supportReplyEmailSubject,
} from "@/lib/support-reply-email";
import { loadOrgAdminUserIds } from "@/lib/platform-org-campaigns/recipient-resolver";

export type SupportTicketType = "dotaz" | "napad" | "feature";
export type SupportTicketStatus = "open" | "answered" | "closed";
export type SupportSenderRole = "organization" | "admin";

export function normalizeSupportTicketType(raw: string): SupportTicketType | null {
  const t = String(raw || "").trim();
  if (t === "dotaz" || t === "napad" || t === "feature") return t;
  return null;
}

export function normalizeSupportTicketStatus(raw: string): SupportTicketStatus | null {
  const t = String(raw || "").trim();
  if (t === "open" || t === "answered" || t === "closed") return t;
  return null;
}

export async function loadCompanyDisplayName(
  db: Firestore,
  organizationId: string
): Promise<string> {
  const snap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  const d = (snap.data() ?? {}) as Record<string, unknown>;
  const name = String(d.companyName || d.name || "").trim();
  return name || organizationId;
}

export async function createSupportTicketAdmin(
  db: Firestore,
  input: {
    organizationId: string;
    organizationName: string;
    type: SupportTicketType;
    subject: string;
    firstMessage: string;
    createdByUid: string;
  }
): Promise<string> {
  const subject = input.subject.trim().slice(0, 300);
  const first = input.firstMessage.trim().slice(0, 20_000);
  if (!subject) throw new Error("Chybí předmět.");
  if (!first) throw new Error("Chybí text zprávy.");

  const ticketRef = db.collection(SUPPORT_TICKETS_COLLECTION).doc();
  const batch = db.batch();
  batch.set(ticketRef, {
    organizationId: input.organizationId,
    organizationName: input.organizationName.slice(0, 200),
    type: input.type,
    subject,
    status: "open" satisfies SupportTicketStatus,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessageText: first.slice(0, 500),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessageRole: "organization" satisfies SupportSenderRole,
    createdByUid: input.createdByUid,
  });
  const msgRef = ticketRef.collection("messages").doc();
  batch.set(msgRef, {
    senderRole: "organization" satisfies SupportSenderRole,
    message: first,
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return ticketRef.id;
}

async function resolveOrganizationContactEmail(
  db: Firestore,
  organizationId: string
): Promise<string | null> {
  const snap = await db.collection(COMPANIES_COLLECTION).doc(organizationId).get();
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  for (const c of [data.contactEmail, data.email, data.billingEmail, data.ownerEmail]) {
    const e = String(c ?? "").trim().toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return e;
  }
  return null;
}

export type AppendSupportMessageResult = {
  emailQueued: boolean;
  emailError?: string | null;
  notificationCount: number;
};

export async function appendSupportMessageAdmin(
  db: Firestore,
  ticketId: string,
  input: { senderRole: SupportSenderRole; message: string }
): Promise<AppendSupportMessageResult> {
  const text = input.message.trim().slice(0, 20_000);
  if (!text) throw new Error("Prázdná zpráva.");

  const ticketRef = db.collection(SUPPORT_TICKETS_COLLECTION).doc(ticketId);
  const snap = await ticketRef.get();
  if (!snap.exists) throw new Error("Ticket neexistuje.");
  const ticket = snap.data() as Record<string, unknown>;
  const st = String(ticket.status || "");
  if (st === "closed") throw new Error("Ticket je uzavřený.");

  const msgRef = ticketRef.collection("messages").doc();
  const batch = db.batch();
  batch.set(msgRef, {
    senderRole: input.senderRole,
    message: text,
    createdAt: FieldValue.serverTimestamp(),
  });
  const patch: Record<string, unknown> = {
    lastMessageText: text.slice(0, 500),
    lastMessageAt: FieldValue.serverTimestamp(),
    lastMessageRole: input.senderRole,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.senderRole === "admin") {
    patch.status = "answered";
  }
  batch.set(ticketRef, patch, { merge: true });
  await batch.commit();

  let emailQueued = false;
  let emailError: string | null = null;
  let notificationCount = 0;

  if (input.senderRole === "admin") {
    const organizationId = String(ticket.organizationId ?? "").trim();
    const organizationName = String(ticket.organizationName ?? organizationId).trim();
    const subject = String(ticket.subject ?? "Dotaz").trim();
    const adminUids = organizationId ? await loadOrgAdminUserIds(db, organizationId) : [];
    for (const uid of adminUids) {
      await createNotification({
        recipientUserId: uid,
        organizationId,
        type: "SYSTEM_ALERT",
        category: "system",
        title: "RAJMONDATA – nová odpověď od podpory",
        body: text.slice(0, 200),
        url: `/portal/help/${ticketId}`,
        entityType: "system",
        entityId: ticketId,
        eventId: `support-reply:${ticketId}:${msgRef.id}`,
        forcePush: false,
      });
      notificationCount += 1;
    }

    const to = organizationId ? await resolveOrganizationContactEmail(db, organizationId) : null;
    if (to) {
      try {
        await db.collection(MAIL_DISPATCH_QUEUE).add({
          kind: "support_ticket_reply",
          status: "pending",
          ticketId,
          organizationId,
          to,
          subject: supportReplyEmailSubject(subject),
          html: buildSupportReplyEmailHtml({
            organizationName,
            subject,
            previewText: text,
            ticketId,
          }),
          sendAt: Timestamp.now(),
          attempts: 0,
          createdAt: FieldValue.serverTimestamp(),
        });
        emailQueued = true;
        await ticketRef.set(
          {
            lastReplyEmailStatus: "queued",
            lastReplyEmailError: null,
          },
          { merge: true }
        );
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
        await ticketRef.set(
          {
            lastReplyEmailStatus: "error",
            lastReplyEmailError: emailError.slice(0, 500),
          },
          { merge: true }
        );
      }
    } else {
      emailError = "Chybí kontaktní e-mail organizace.";
      await ticketRef.set(
        {
          lastReplyEmailStatus: "skipped",
          lastReplyEmailError: emailError,
        },
        { merge: true }
      );
    }
  }

  return { emailQueued, emailError, notificationCount };
}
