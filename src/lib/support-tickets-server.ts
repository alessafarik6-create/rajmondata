import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { COMPANIES_COLLECTION, SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";

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

export async function appendSupportMessageAdmin(
  db: Firestore,
  ticketId: string,
  input: { senderRole: SupportSenderRole; message: string }
): Promise<void> {
  const text = input.message.trim().slice(0, 20_000);
  if (!text) throw new Error("Prázdná zpráva.");

  const ticketRef = db.collection(SUPPORT_TICKETS_COLLECTION).doc(ticketId);
  const snap = await ticketRef.get();
  if (!snap.exists) throw new Error("Ticket neexistuje.");
  const st = String((snap.data() as Record<string, unknown>).status || "");
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
}
