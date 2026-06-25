import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import {
  formatMessageDateFromValue,
  MESSAGE_DATE_UNKNOWN,
  safeTime,
} from "@/lib/date-safe";

const CUSTOMER_ACTIVITY_TIMESTAMP_KEYS = [
  "createdAt",
  "timestamp",
  "sentAt",
  "updatedAt",
] as const;

/** Milisekundy aktivity — createdAt, pak timestamp, sentAt, updatedAt. */
export function resolveCustomerActivityAtMs(
  data: Record<string, unknown> | null | undefined
): number {
  if (!data) return 0;
  for (const key of CUSTOMER_ACTIVITY_TIMESTAMP_KEYS) {
    const ms = safeTime(data[key]);
    if (ms > 0) return ms;
  }
  return 0;
}

/** Formát DD.MM.YYYY HH:mm nebo „Neznámé datum“. */
export function formatCustomerActivityDateTime(
  data: Record<string, unknown> | null | undefined
): string {
  const ms = resolveCustomerActivityAtMs(data);
  if (!ms) return MESSAGE_DATE_UNKNOWN;
  return formatMessageDateFromValue(ms);
}

const CUSTOMER_ACTIVITY_FRESH_MS = 72 * 60 * 60 * 1000;

export type CustomerActivityVisualAge = "fresh" | "stale" | "resolved";

/** Vizuální stáří pro dashboard (hranice 72 h). */
export function customerActivityVisualAge(
  data: Record<string, unknown> | null | undefined,
  nowMs: number = Date.now()
): CustomerActivityVisualAge {
  if (!data || data.resolved === true) return "resolved";
  const ms = resolveCustomerActivityAtMs(data);
  if (!ms) return "stale";
  return nowMs - ms < CUSTOMER_ACTIVITY_FRESH_MS ? "fresh" : "stale";
}

/** Seřadí aktivity od nejnovějších (podle času aktivity). */
export function sortCustomerActivitiesByNewest<T extends { id: string }>(
  rows: T[],
  readMs: (row: T) => number = (row) =>
    resolveCustomerActivityAtMs(row as unknown as Record<string, unknown>)
): T[] {
  return [...rows].sort((a, b) => readMs(b) - readMs(a));
}

export type CustomerActivityType =
  | "customer_product_selected"
  | "customer_product_deselected"
  | "customer_product_selection_updated"
  | "customer_annotation_created"
  | "customer_annotation_updated"
  | "customer_note_added"
  | "customer_chat_message"
  | "customer_document_comment"
  | "customer_pdf_annotation"
  | "customer_image_annotation"
  | "customer_media_review_comment"
  | "customer_media_approval_approved"
  | "customer_media_changes_requested";

export type CustomerActivityPayload = {
  organizationId: string;
  jobId?: string | null;
  customerId?: string | null;
  customerUserId: string;
  type: CustomerActivityType;
  title: string;
  message: string;
  createdBy: string;
  createdByRole: "customer";
  isRead: boolean;
  targetType: "job" | "chat" | "annotation" | "catalog-selection";
  targetId: string;
  targetLink?: string;
  /** ID souboru ve fotodokumentaci (složka / legacy photos). */
  documentId?: string | null;
  folderId?: string | null;
  documentType?: "image" | "pdf" | "other" | null;
  commentId?: string | null;
  fileName?: string | null;
  priority?: "low" | "normal" | "high";
};

/** Rozšíření záznamu o vyřízení (stará data bez polí = nevyřízeno). */
export type CustomerActivityResolvedFields = {
  resolved?: boolean;
  resolvedAt?: unknown;
  resolvedBy?: string | null;
};

/** Stará data bez `resolved` považuj za nevyřízená. */
export function isCustomerActivityUnresolved(
  data: CustomerActivityResolvedFields | Record<string, unknown>
): boolean {
  return data.resolved !== true;
}

export async function createCustomerActivity(
  firestore: Firestore,
  payload: CustomerActivityPayload
): Promise<void> {
  const data = {
    ...payload,
    createdAt: serverTimestamp(),
    readAt: null,
    readBy: null,
    priority: payload.priority ?? "normal",
    resolved: false,
    resolvedAt: null,
    resolvedBy: null,
  };
  if (process.env.NODE_ENV === "development") {
    console.log("customer activity created", data);
  }
  await addDoc(
    collection(firestore, "companies", payload.organizationId, "customer_activities"),
    data
  );
}

