import type { User } from "firebase/auth";
import type { LeadReminderQuickPresetId } from "@/lib/leads/lead-reminder-datetime";
import type { LeadReminderRecord } from "@/lib/leads/lead-reminder-types";

async function bearer(user: User): Promise<string> {
  return user.getIdToken();
}

export async function createLeadReminder(
  user: User,
  input: {
    companyId: string;
    leadKey: string;
    importLeadId: string;
    customerName: string;
    inquiryTitle: string;
    assignedUserId: string;
    note: string;
    preset?: LeadReminderQuickPresetId;
    dateYmd?: string;
    hour?: number;
    minute?: number;
    remindAtIso?: string;
  }
): Promise<{ ok: boolean; reminder?: LeadReminderRecord; error?: string }> {
  const token = await bearer(user);
  const res = await fetch("/api/company/lead-reminders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    reminder?: LeadReminderRecord;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? "Uložení selhalo." };
  }
  return { ok: true, reminder: data.reminder };
}

export async function patchLeadReminder(
  user: User,
  reminderId: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; remindAt?: string }> {
  const token = await bearer(user);
  const res = await fetch(`/api/company/lead-reminders/${encodeURIComponent(reminderId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; remindAt?: string };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? "Akce selhala." };
  }
  return { ok: true, remindAt: data.remindAt };
}

export async function deleteLeadReminder(
  user: User,
  companyId: string,
  reminderId: string
): Promise<{ ok: boolean; error?: string }> {
  const token = await bearer(user);
  const res = await fetch(
    `/api/company/lead-reminders/${encodeURIComponent(reminderId)}?companyId=${encodeURIComponent(companyId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? "Smazání selhalo." };
  }
  return { ok: true };
}

let leadReminderProcessBackoffUntil = 0;
let leadReminderProcessFailures = 0;

export async function processDueLeadReminders(user: User): Promise<void> {
  if (Date.now() < leadReminderProcessBackoffUntil) return;
  const token = await bearer(user);
  try {
    const res = await fetch("/api/company/lead-reminders/process-due", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      leadReminderProcessFailures += 1;
      const delayMs = Math.min(300_000, 15_000 * leadReminderProcessFailures);
      leadReminderProcessBackoffUntil = Date.now() + delayMs;
      return;
    }
    leadReminderProcessFailures = 0;
    leadReminderProcessBackoffUntil = 0;
  } catch {
    leadReminderProcessFailures += 1;
    const delayMs = Math.min(300_000, 15_000 * leadReminderProcessFailures);
    leadReminderProcessBackoffUntil = Date.now() + delayMs;
  }
}

export function parseLeadReminderRow(
  id: string,
  row: Record<string, unknown>
): LeadReminderRecord | null {
  const remindAt =
    row.remindAt &&
    typeof row.remindAt === "object" &&
    "toDate" in row.remindAt &&
    typeof (row.remindAt as { toDate: () => Date }).toDate === "function"
      ? (row.remindAt as { toDate: () => Date }).toDate().toISOString()
      : typeof row.remindAt === "string"
        ? row.remindAt
        : "";
  if (!remindAt) return null;
  return {
    id,
    companyId: String(row.companyId ?? ""),
    organizationId: String(row.organizationId ?? row.companyId ?? ""),
    leadKey: String(row.leadKey ?? ""),
    importLeadId: String(row.importLeadId ?? ""),
    customerName: String(row.customerName ?? ""),
    inquiryTitle: String(row.inquiryTitle ?? ""),
    assignedUserId: String(row.assignedUserId ?? ""),
    assignedDisplayName:
      typeof row.assignedDisplayName === "string" ? row.assignedDisplayName : null,
    note: String(row.note ?? ""),
    remindAt,
    status: row.status === "done" ? "done" : "active",
    notificationFired: row.notificationFired === true,
    firedAt: null,
    createdBy: String(row.createdBy ?? ""),
    createdAt: null,
    updatedAt: null,
    completedAt: null,
  };
}
