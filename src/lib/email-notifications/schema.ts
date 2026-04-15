/**
 * Centrální nastavení e-mailových notifikací organizace (ukládá se na dokument firmy).
 */

export type EmailModuleKey =
  | "orders"
  | "documents"
  | "invoices"
  | "leads"
  | "calendar"
  | "warehouse"
  | "attendance"
  | "messages"
  | "system";

export type OrdersEmailFlags = {
  enabled: boolean;
  newOrder: boolean;
  orderUpdated: boolean;
  orderStatusChanged: boolean;
  noteAdded: boolean;
  attachmentAdded: boolean;
};

export type DocumentsEmailFlags = {
  enabled: boolean;
  newDocument: boolean;
  pendingAssignment: boolean;
  updated: boolean;
  approvedOrProcessed: boolean;
};

export type InvoicesEmailFlags = {
  enabled: boolean;
  newInvoice: boolean;
  invoiceUpdated: boolean;
  statusChanged: boolean;
  dueReminder: boolean;
};

export type LeadsEmailFlags = {
  enabled: boolean;
  newLead: boolean;
  leadStatusChanged: boolean;
};

export type CalendarEmailFlags = {
  enabled: boolean;
  eventCreated: boolean;
  eventUpdated: boolean;
  eventDeleted: boolean;
  /** Připomenutí X minut před začátkem (hodnoty v minutách). */
  reminderEnabled: boolean;
  reminderOffsetsMinutes: number[];
  /** true = jen schůzky (lead_meetings), false = i zaměření apod. */
  reminderMeetingsOnly: boolean;
  /** Krátké upozornění při události konané „dnes“ (odesláno při uložení záznamu). */
  todayEventReminder: boolean;
};

export type WarehouseEmailFlags = {
  enabled: boolean;
  stockIn: boolean;
  stockOut: boolean;
  productionStatusChanged: boolean;
};

export type AttendanceEmailFlags = {
  enabled: boolean;
  newWorkReports: boolean;
  payrollApproved: boolean;
  attendanceChanged: boolean;
  leaveRequestChanged: boolean;
};

export type MessagesEmailFlags = {
  enabled: boolean;
  newCustomerMessage: boolean;
  newInternalMessage: boolean;
};

export type SystemEmailFlags = {
  enabled: boolean;
  importantDataChange: boolean;
  importError: boolean;
  pendingItemsReminder: boolean;
};

export type EmailNotificationsModules = {
  orders: OrdersEmailFlags;
  documents: DocumentsEmailFlags;
  invoices: InvoicesEmailFlags;
  leads: LeadsEmailFlags;
  calendar: CalendarEmailFlags;
  warehouse: WarehouseEmailFlags;
  attendance: AttendanceEmailFlags;
  messages: MessagesEmailFlags;
  system: SystemEmailFlags;
};

export type EmailNotificationsSettings = {
  /** Hlavní vypínač — vypnuto = žádné modulové e-maily. */
  enabled: boolean;
  /** Ručně zadané adresy. */
  recipients: string[];
  /** ID dokumentů companies/{cid}/employees/{id}. */
  recipientEmployeeIds: string[];
  /** Přidat e-maily všech uživatelů s rolí owner nebo admin v organizaci. */
  includeOrganizationAdmins: boolean;
  modules: EmailNotificationsModules;
};

export const DEFAULT_EMAIL_NOTIFICATIONS: EmailNotificationsSettings = {
  enabled: false,
  recipients: [],
  recipientEmployeeIds: [],
  includeOrganizationAdmins: true,
  modules: {
    orders: {
      enabled: true,
      newOrder: true,
      orderUpdated: true,
      orderStatusChanged: true,
      noteAdded: true,
      attachmentAdded: true,
    },
    documents: {
      enabled: true,
      newDocument: true,
      pendingAssignment: true,
      updated: true,
      approvedOrProcessed: true,
    },
    invoices: {
      enabled: true,
      newInvoice: true,
      invoiceUpdated: true,
      statusChanged: true,
      dueReminder: false,
    },
    leads: {
      enabled: true,
      newLead: true,
      leadStatusChanged: true,
    },
    calendar: {
      enabled: true,
      eventCreated: true,
      eventUpdated: true,
      eventDeleted: true,
      reminderEnabled: false,
      reminderOffsetsMinutes: [15, 30, 60],
      reminderMeetingsOnly: true,
      todayEventReminder: false,
    },
    warehouse: {
      enabled: true,
      stockIn: true,
      stockOut: true,
      productionStatusChanged: true,
    },
    attendance: {
      enabled: true,
      newWorkReports: true,
      payrollApproved: true,
      attendanceChanged: true,
      leaveRequestChanged: true,
    },
    messages: {
      enabled: true,
      newCustomerMessage: true,
      newInternalMessage: true,
    },
    system: {
      enabled: true,
      importantDataChange: false,
      importError: true,
      pendingItemsReminder: false,
    },
  },
};

const CALENDAR_OFFSET_PRESETS = [15, 30, 60, 180, 1440] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function mergeFlags<T extends Record<string, unknown>>(defaults: T, raw: unknown): T {
  if (!isPlainObject(raw)) return { ...defaults };
  const out: Record<string, unknown> = { ...defaults };
  const rawObj = raw as Record<string, unknown>;
  for (const k of Object.keys(defaults)) {
    if (k in rawObj) {
      const rv = rawObj[k];
      const dv = defaults[k];
      if (typeof dv === "boolean" && typeof rv === "boolean") {
        out[k] = rv;
      } else if (typeof dv === "number" && typeof rv === "number") {
        out[k] = rv;
      } else if (Array.isArray(dv) && Array.isArray(rv)) {
        out[k] = rv;
      }
    }
  }
  return out as T;
}

function normalizeOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EMAIL_NOTIFICATIONS.modules.calendar.reminderOffsetsMinutes];
  const nums = raw
    .map((x) => (typeof x === "number" ? x : Number(x)))
    .filter((n) => Number.isFinite(n) && n > 0);
  const allowed = new Set<number>(CALENDAR_OFFSET_PRESETS as unknown as number[]);
  const filtered = nums.filter((n) => allowed.has(Math.round(n)));
  return filtered.length ? [...new Set(filtered.map((n) => Math.round(n)))].sort((a, b) => a - b) : [
    ...DEFAULT_EMAIL_NOTIFICATIONS.modules.calendar.reminderOffsetsMinutes,
  ];
}

/** Sloučí uložená data s výchozími hodnotami (bezpečné po rozšíření schématu). */
export function mergeEmailNotifications(raw: unknown): EmailNotificationsSettings {
  const d = DEFAULT_EMAIL_NOTIFICATIONS;
  if (!isPlainObject(raw)) return structuredClone(d);

  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    : d.recipients;

  const recipientEmployeeIds = Array.isArray(raw.recipientEmployeeIds)
    ? raw.recipientEmployeeIds.map((x) => String(x).trim()).filter(Boolean)
    : Array.isArray((raw as { recipientUserIds?: unknown }).recipientUserIds)
      ? (raw as { recipientUserIds: string[] }).recipientUserIds.map((x) => String(x).trim()).filter(Boolean)
      : d.recipientEmployeeIds;

  const includeOrganizationAdmins =
    typeof raw.includeOrganizationAdmins === "boolean"
      ? raw.includeOrganizationAdmins
      : d.includeOrganizationAdmins;

  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : d.enabled;

  const mods = isPlainObject(raw.modules) ? raw.modules : {};
  const calendarRaw = isPlainObject(mods.calendar) ? mods.calendar : {};

  const calendarMerged = mergeFlags(d.modules.calendar, calendarRaw);
  calendarMerged.reminderOffsetsMinutes = normalizeOffsets(
    (calendarRaw as { reminderOffsetsMinutes?: unknown }).reminderOffsetsMinutes
  );

  return {
    enabled,
    recipients,
    recipientEmployeeIds,
    includeOrganizationAdmins,
    modules: {
      orders: mergeFlags(d.modules.orders, mods.orders),
      documents: mergeFlags(d.modules.documents, mods.documents),
      invoices: mergeFlags(d.modules.invoices, mods.invoices),
      leads: mergeFlags(d.modules.leads, mods.leads),
      calendar: calendarMerged,
      warehouse: mergeFlags(d.modules.warehouse, mods.warehouse),
      attendance: mergeFlags(d.modules.attendance, mods.attendance),
      messages: mergeFlags(d.modules.messages, mods.messages),
      system: mergeFlags(d.modules.system, mods.system),
    },
  };
}

export function isModuleEventEnabled(
  settings: EmailNotificationsSettings,
  module: EmailModuleKey,
  eventKey: string
): boolean {
  if (!settings.enabled) return false;
  const mod = settings.modules[module];
  if (!mod || !("enabled" in mod) || mod.enabled !== true) return false;
  if (module === "calendar" && eventKey === "reminder") {
    return (mod as CalendarEmailFlags).reminderEnabled === true;
  }
  const flag = (mod as Record<string, unknown>)[eventKey];
  return flag === true;
}

export const CALENDAR_REMINDER_OFFSET_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 minut předem" },
  { value: 30, label: "30 minut předem" },
  { value: 60, label: "1 hodina předem" },
  { value: 180, label: "3 hodiny předem" },
  { value: 1440, label: "1 den předem" },
];
