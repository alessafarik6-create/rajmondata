import type { CompanyScheduleCalendarEvent } from "@/lib/company-schedule-events";
import { messageAuthorRoleLabelFromRecord } from "@/lib/format-message-date";

export type CalendarEventAuthorFields = {
  createdByUid?: string;
  createdByName?: string;
  createdByRole?: string;
};

export function parseCalendarAuthorFromFirestore(
  raw: Record<string, unknown> | null | undefined
): CalendarEventAuthorFields {
  if (!raw || typeof raw !== "object") return {};
  const uidRaw =
    (typeof raw.createdByUserId === "string" && raw.createdByUserId.trim()) ||
    (typeof raw.createdBy === "string" && raw.createdBy.trim()) ||
    "";
  const createdByUid = uidRaw || undefined;
  const createdByName =
    typeof raw.createdByName === "string" && raw.createdByName.trim()
      ? raw.createdByName.trim()
      : undefined;
  const createdByRole =
    typeof raw.createdByRole === "string" && raw.createdByRole.trim()
      ? raw.createdByRole.trim()
      : undefined;
  return { createdByUid, createdByName, createdByRole };
}

export function calendarAuthorPersistFieldsFromSession(params: {
  userId: string;
  displayName: string;
  role: string;
}): Record<string, string> {
  const userId = String(params.userId ?? "").trim();
  const displayName = String(params.displayName ?? "").trim() || "—";
  const role = String(params.role ?? "").trim() || "employee";
  return {
    createdBy: userId,
    createdByUserId: userId,
    createdByName: displayName,
    createdByRole: role,
  };
}

export function calendarUpdateAuthorFieldsFromSession(params: {
  userId: string;
  displayName: string;
  role: string;
}): Record<string, string> {
  const userId = String(params.userId ?? "").trim();
  const displayName = String(params.displayName ?? "").trim() || "—";
  const role = String(params.role ?? "").trim() || "employee";
  return {
    updatedByUserId: userId,
    updatedByName: displayName,
    updatedByRole: role,
  };
}

function calendarRoleLabelCs(role: string | undefined): string {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return "";
  if (r === "owner") return "Vlastník";
  if (r === "accountant") return "Účetní";
  const generic = messageAuthorRoleLabelFromRecord({ createdByRole: r });
  return generic === "—" ? "" : generic;
}

export function formatCalendarCreatedByLine(
  ev: Pick<CompanyScheduleCalendarEvent, "createdByUid" | "createdByName" | "createdByRole">
): string {
  const name = ev.createdByName?.trim();
  if (name) {
    const roleLabel = calendarRoleLabelCs(ev.createdByRole);
    return roleLabel ? `${name} · ${roleLabel}` : name;
  }
  if (ev.createdByUid) return "Neznámý uživatel";
  return "Neznámý uživatel";
}
