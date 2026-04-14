"use client";

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";

export type EmployeeNotificationType =
  | "info"
  | "important"
  | "training"
  | "meeting";

export type EmployeeNotificationDoc = {
  id: string;
  companyId: string;
  /** Alias organizationId === companyId (kvůli konzistenci s požadovaným modelem). */
  organizationId?: string;
  employeeId: string;
  eventId?: string | null;
  title: string;
  message: string;
  type: EmployeeNotificationType;
  eventDate?: string | null; // yyyy-MM-dd
  eventTime?: string | null; // HH:mm
  linkUrl?: string | null;
  sentBy?: string | null;
  sentToAllEmployees: boolean;
  isRead: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  readAt?: unknown;
  deleted?: boolean;
};

export function employeeNotificationDocId(params: {
  eventId: string;
  employeeId: string;
}): string {
  return `${params.eventId}__${params.employeeId}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function upsertEmployeeNotificationsForEvent(params: {
  firestore: Firestore;
  companyId: string;
  eventId: string;
  employeeIds: string[];
  title: string;
  message: string;
  type: EmployeeNotificationType;
  eventDate: string; // yyyy-MM-dd
  eventTime: string; // HH:mm
  sentBy: string;
  linkUrl?: string | null;
}): Promise<{ upserted: number }> {
  const {
    firestore,
    companyId,
    eventId,
    employeeIds,
    title,
    message,
    type,
    eventDate,
    eventTime,
    sentBy,
    linkUrl,
  } = params;

  const ids = employeeIds.map((s) => String(s).trim()).filter(Boolean);
  if (ids.length === 0) return { upserted: 0 };

  console.log("[employee-notifications] upsert start", {
    companyId,
    eventId,
    recipientCount: ids.length,
  });

  const existingSnap = await getDocs(
    query(
      collection(firestore, "companies", companyId, "employee_notifications"),
      where("eventId", "==", eventId),
      limit(5000)
    )
  );
  const existingByEmployee = new Set<string>();
  for (const d of existingSnap.docs) {
    const emp = String((d.data() as any)?.employeeId ?? "").trim();
    if (emp) existingByEmployee.add(emp);
  }

  // Firestore limit 500 ops per batch; keep buffer.
  const batches = chunk([...new Set(ids)], 400);
  let upserted = 0;
  for (const list of batches) {
    const batch = writeBatch(firestore);
    for (const employeeId of list) {
      const notifId = employeeNotificationDocId({ eventId, employeeId });
      const ref = doc(
        firestore,
        "companies",
        companyId,
        "employee_notifications",
        notifId
      );
      const base = {
        companyId,
        /** Stejná hodnota jako companyId — alias pro přehled v datech / integrace. */
        organizationId: companyId,
        employeeId,
        eventId,
        title,
        message,
        type,
        eventDate,
        eventTime,
        /** Výchozí cíl pro zaměstnance (dashboard organizace často nemá). */
        linkUrl: linkUrl ?? "/portal/employee",
        sentBy,
        sentToAllEmployees: true,
        updatedAt: serverTimestamp(),
      };
      if (existingByEmployee.has(employeeId)) {
        batch.update(ref, base);
      } else {
        batch.set(ref, { ...base, isRead: false, createdAt: serverTimestamp() });
      }
      upserted += 1;
    }
    await batch.commit();
  }
  console.log("[employee-notifications] upsert done", { upserted });
  return { upserted };
}

export async function deleteEmployeeNotificationsForEvent(params: {
  firestore: Firestore;
  companyId: string;
  eventId: string;
}): Promise<{ deleted: number }> {
  const { firestore, companyId, eventId } = params;
  const q = query(
    collection(firestore, "companies", companyId, "employee_notifications"),
    where("eventId", "==", eventId),
    limit(5000)
  );
  const snap = await getDocs(q);
  if (snap.empty) return { deleted: 0 };

  const docs = snap.docs;
  const batches = chunk(docs, 400);
  let deleted = 0;
  for (const list of batches) {
    const batch = writeBatch(firestore);
    for (const d of list) {
      batch.delete(d.ref);
      deleted += 1;
    }
    await batch.commit();
  }
  return { deleted };
}

