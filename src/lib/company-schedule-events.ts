import { parseISO } from "date-fns";
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import type { MeasurementDoc, MeasurementStatus } from "@/lib/measurements";
import { MEASUREMENT_STATUS_LABELS } from "@/lib/measurements";
import type { EmployeeNotificationType } from "@/lib/employee-notifications";

export type MeetingStatus = "planned" | "done" | "cancelled";

/** Stav v `lead_meetings.status` pro calendarEventType installation */
export type InstallationStatus = "planned" | "inProgress" | "done" | "canceled";

export type CompanyScheduleCalendarEvent = {
  id: string;
  at: Date;
  /** Konec intervalu (čas do), pokud je uložen ve Firestore. */
  endsAt?: Date;
  /** Autor záznamu ve Firestore (`lead_meetings.createdBy`) — pro filtrování u zaměstnance. */
  createdByUid?: string;
  title: string;
  headline: string;
  kind: "meeting" | "measurement" | "installation";
  detail?: string;
  phone?: string;
  address?: string;
  status: MeetingStatus | "measurement" | InstallationStatus;
  statusLabel: string;
  badgeClass: string;
  accentClass: string;
  sourceId?: string;
  eventNote?: string;
  sentToAllEmployees?: boolean;
  notificationType?: EmployeeNotificationType;
  notificationMessage?: string | null;
  titleClass?: string;
  /** Hodnota z `lead_meetings.calendarEventType` */
  calendarEventType?: string;
  jobId?: string;
  jobName?: string;
  customerId?: string;
  /** Pro montáže — kdo montáž uvidí a může měnit stav. */
  assignedEmployeeIds?: string[];
  assignedEmployeeNames?: string[];
};

function isMeasurementDeleted(m: { deletedAt?: unknown }): boolean {
  return m.deletedAt != null;
}

function parseMeasurementTime(raw: string): Date | null {
  try {
    const d = parseISO(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function measurementVisuals(status: MeasurementStatus | undefined): {
  badgeClass: string;
  accentClass: string;
} {
  switch (status) {
    case "completed":
      return {
        badgeClass: "border-sky-200 bg-sky-100 text-sky-950",
        accentClass: "border-l-sky-500",
      };
    case "converted":
      return {
        badgeClass: "border-violet-200 bg-violet-100 text-violet-950",
        accentClass: "border-l-violet-500",
      };
    case "cancelled":
      return {
        badgeClass: "border-slate-200 bg-slate-100 text-slate-800",
        accentClass: "border-l-slate-400",
      };
    default:
      return {
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
      };
  }
}

function meetingVisuals(status: MeetingStatus | undefined): {
  statusLabel: string;
  badgeClass: string;
  accentClass: string;
  titleClass: string;
} {
  switch (status) {
    case "done":
      return {
        statusLabel: "Vyřízeno",
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
        titleClass: "opacity-80",
      };
    case "cancelled":
      return {
        statusLabel: "Zrušeno",
        badgeClass: "border-rose-200 bg-rose-50 text-rose-900",
        accentClass: "border-l-rose-400",
        titleClass: "line-through text-slate-500",
      };
    default:
      return {
        statusLabel: "Plánováno",
        badgeClass: "border-orange-200 bg-orange-100 text-orange-950",
        accentClass: "border-l-orange-500",
        titleClass: "",
      };
  }
}

function installationVisuals(status: InstallationStatus | undefined): {
  statusLabel: string;
  badgeClass: string;
  accentClass: string;
  titleClass: string;
} {
  switch (status) {
    case "inProgress":
      return {
        statusLabel: "Probíhá",
        badgeClass: "border-amber-200 bg-amber-100 text-amber-950",
        accentClass: "border-l-amber-500",
        titleClass: "",
      };
    case "done":
      return {
        statusLabel: "Hotovo",
        badgeClass: "border-emerald-200 bg-emerald-100 text-emerald-950",
        accentClass: "border-l-emerald-500",
        titleClass: "opacity-80",
      };
    case "canceled":
      return {
        statusLabel: "Zrušeno",
        badgeClass: "border-rose-200 bg-rose-50 text-rose-900",
        accentClass: "border-l-rose-400",
        titleClass: "line-through text-slate-500",
      };
    default:
      return {
        statusLabel: "Naplánováno",
        badgeClass: "border-violet-200 bg-violet-100 text-violet-950",
        accentClass: "border-l-violet-500",
        titleClass: "",
      };
  }
}

export function parseInstallationStatus(raw: string): InstallationStatus {
  const s = raw.trim();
  if (s === "inProgress") return "inProgress";
  if (s === "done") return "done";
  if (s === "canceled" || s === "cancelled") return "canceled";
  return "planned";
}

export function isValidCompanyScheduleEvent(e: unknown): e is CompanyScheduleCalendarEvent {
  if (e == null || typeof e !== "object") return false;
  const o = e as Partial<CompanyScheduleCalendarEvent>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (typeof o.headline !== "string") return false;
  if (typeof o.statusLabel !== "string") return false;
  if (typeof o.badgeClass !== "string") return false;
  if (typeof o.accentClass !== "string") return false;
  return o.at instanceof Date && !Number.isNaN(o.at.getTime());
}

export function buildCompanyScheduleEvents(
  meetingsRaw: unknown,
  measurementsRaw: unknown
): CompanyScheduleCalendarEvent[] {
  const out: CompanyScheduleCalendarEvent[] = [];
  const list = Array.isArray(meetingsRaw) ? meetingsRaw : [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = String(raw?.id ?? "");
    if (!id) continue;
    const at = parseFirestoreScheduledAt(raw.scheduledAt);
    if (!at) continue;
    const endsAt = parseFirestoreScheduledAt(raw.endsAt);
    const customerName = String(raw.customerName ?? "—");
    const note = String(raw.note ?? "").trim();
    const phone = String(raw.phone ?? "").trim();
    const place = String(raw.place ?? "").trim();
    const calendarEventTypeRaw = String(raw?.calendarEventType ?? "lead_meeting").trim();
    const isInstallation = calendarEventTypeRaw === "installation";

    const sentToAllEmployees = raw?.sentToAllEmployees === true;
    const notificationType =
      String(raw?.notificationType ?? "").trim() as EmployeeNotificationType;
    const nt: EmployeeNotificationType =
      notificationType === "important" ||
      notificationType === "training" ||
      notificationType === "meeting" ||
      notificationType === "info"
        ? notificationType
        : "info";
    const notificationMessage =
      typeof raw?.notificationMessage === "string" && raw.notificationMessage.trim()
        ? raw.notificationMessage.trim()
        : null;
    const createdByUid =
      typeof raw?.createdBy === "string" && raw.createdBy.trim() ? raw.createdBy.trim() : undefined;

    const assignedEmployeeIdsRaw = raw?.assignedEmployeeIds;
    const assignedEmployeeIds = Array.isArray(assignedEmployeeIdsRaw)
      ? assignedEmployeeIdsRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : undefined;
    const assignedEmployeeNamesRaw = raw?.assignedEmployeeNames;
    const assignedEmployeeNames = Array.isArray(assignedEmployeeNamesRaw)
      ? assignedEmployeeNamesRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : undefined;

    const jobId =
      typeof raw.jobId === "string" && raw.jobId.trim() ? raw.jobId.trim() : undefined;
    const jobName =
      typeof raw.jobName === "string" && raw.jobName.trim() ? raw.jobName.trim() : undefined;
    const customerId =
      typeof raw.customerId === "string" && raw.customerId.trim()
        ? raw.customerId.trim()
        : undefined;

    if (isInstallation) {
      const stRaw = String(raw.status ?? "").trim();
      const instSt = parseInstallationStatus(stRaw);
      const v = installationVisuals(instSt);
      const headline = String(raw.title ?? "").trim() || note || "Montáž";
      out.push({
        id: `m-${id}`,
        at,
        endsAt: endsAt ?? undefined,
        createdByUid,
        title: customerName,
        headline,
        kind: "installation",
        calendarEventType: "installation",
        detail: note || "Montáž",
        phone: phone || undefined,
        address: place || undefined,
        status: instSt,
        statusLabel: v.statusLabel,
        badgeClass: v.badgeClass,
        accentClass: v.accentClass,
        sourceId: id,
        eventNote: note,
        sentToAllEmployees,
        notificationType: nt,
        notificationMessage,
        titleClass: v.titleClass,
        jobId,
        jobName,
        customerId,
        assignedEmployeeIds,
        assignedEmployeeNames,
      });
      continue;
    }

    const stRaw = String(raw.status ?? "").trim();
    const st: MeetingStatus =
      stRaw === "done" || stRaw === "cancelled" || stRaw === "planned"
        ? (stRaw as MeetingStatus)
        : "planned";
    const v = meetingVisuals(st);
    const headline = String(raw.title ?? "").trim() || note || "Schůzka";
    out.push({
      id: `m-${id}`,
      at,
      endsAt: endsAt ?? undefined,
      createdByUid,
      title: customerName,
      headline,
      kind: "meeting",
      calendarEventType: calendarEventTypeRaw || "lead_meeting",
      detail: note || "Schůzka",
      phone: phone || undefined,
      address: place || undefined,
      status: st,
      statusLabel: v.statusLabel,
      badgeClass: v.badgeClass,
      accentClass: v.accentClass,
      sourceId: id,
      eventNote: note,
      sentToAllEmployees,
      notificationType: nt,
      notificationMessage,
      titleClass: v.titleClass,
    });
  }

  const mlist = Array.isArray(measurementsRaw) ? measurementsRaw : [];
  for (const raw of mlist as (MeasurementDoc & { id?: string })[]) {
    if (!raw?.id || isMeasurementDeleted(raw)) continue;
    const st = raw.status as MeasurementStatus | undefined;
    const at = parseMeasurementTime(String(raw.scheduledAt ?? ""));
    if (!at) continue;
    const label = MEASUREMENT_STATUS_LABELS[st ?? "planned"] ?? "Zaměření";
    const visuals = measurementVisuals(st);
    const note = String(raw.note ?? "").trim();
    const phone = String(raw.phone ?? "").trim();
    const address = String(raw.address ?? "").trim();
    out.push({
      id: `z-${raw.id}`,
      at,
      title: raw.customerName?.trim() || "—",
      headline: note || "Zaměření",
      kind: "measurement",
      detail: `Zaměření · ${label}`,
      phone: phone || undefined,
      address: address || undefined,
      status: "measurement",
      statusLabel: label,
      badgeClass: visuals.badgeClass,
      accentClass: visuals.accentClass,
    });
  }

  const valid = out.filter(isValidCompanyScheduleEvent);
  valid.sort((a, b) => a.at.getTime() - b.at.getTime());
  return valid;
}
