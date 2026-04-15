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

/** Společná pole příjemců u každého modulu (nebo globálně u firmy). */
export type ModuleRecipientFields = {
  /**
   * true = použít globální seznamy (globalRecipients, …).
   * false = použít jen recipients / recipientUserIds / recipientEmployeeIds u modulu.
   * Výchozí true — migrace ze starého nastavení.
   */
  useGlobalRecipients: boolean;
  /** Ruční e-maily pro tento modul (když useGlobalRecipients === false). */
  recipients: string[];
  /** Firebase Auth UID — e-mail z users/{uid}. */
  recipientUserIds: string[];
  /** ID dokumentu companies/{cid}/employees/{id}. */
  recipientEmployeeIds: string[];
};

export type OrdersEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newOrder: boolean;
  orderUpdated: boolean;
  orderStatusChanged: boolean;
  noteAdded: boolean;
  attachmentAdded: boolean;
};

export type DocumentsEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newDocument: boolean;
  pendingAssignment: boolean;
  updated: boolean;
  approvedOrProcessed: boolean;
};

export type InvoicesEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newInvoice: boolean;
  invoiceUpdated: boolean;
  statusChanged: boolean;
  dueReminder: boolean;
};

export type LeadsEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newLead: boolean;
  leadStatusChanged: boolean;
};

export type CalendarEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  eventCreated: boolean;
  eventUpdated: boolean;
  eventDeleted: boolean;
  reminderEnabled: boolean;
  reminderOffsetsMinutes: number[];
  reminderMeetingsOnly: boolean;
  todayEventReminder: boolean;
};

export type WarehouseEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  stockIn: boolean;
  stockOut: boolean;
  productionStatusChanged: boolean;
};

export type AttendanceEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newWorkReports: boolean;
  payrollApproved: boolean;
  attendanceChanged: boolean;
  leaveRequestChanged: boolean;
};

export type MessagesEmailFlags = ModuleRecipientFields & {
  enabled: boolean;
  newCustomerMessage: boolean;
  newInternalMessage: boolean;
};

export type SystemEmailFlags = ModuleRecipientFields & {
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
  enabled: boolean;
  /** Výchozí ruční adresy (fallback pro moduly s useGlobalRecipients). */
  globalRecipients: string[];
  /** Výchozí Firebase Auth UID → users/{uid}. */
  globalRecipientUserIds: string[];
  /** Výchozí ID zaměstnanců (employees/{id}) — migrace / ruční výběr bez účtu. */
  globalRecipientEmployeeIds: string[];
  includeOrganizationAdmins: boolean;
  modules: EmailNotificationsModules;
};

const EMPTY_RECIPIENTS = (): Pick<
  ModuleRecipientFields,
  "useGlobalRecipients" | "recipients" | "recipientUserIds" | "recipientEmployeeIds"
> => ({
  useGlobalRecipients: true,
  recipients: [],
  recipientUserIds: [],
  recipientEmployeeIds: [],
});

export const DEFAULT_EMAIL_NOTIFICATIONS: EmailNotificationsSettings = {
  enabled: false,
  globalRecipients: [],
  globalRecipientUserIds: [],
  globalRecipientEmployeeIds: [],
  includeOrganizationAdmins: true,
  modules: {
    orders: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newOrder: true,
      orderUpdated: true,
      orderStatusChanged: true,
      noteAdded: true,
      attachmentAdded: true,
    },
    documents: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newDocument: true,
      pendingAssignment: true,
      updated: true,
      approvedOrProcessed: true,
    },
    invoices: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newInvoice: true,
      invoiceUpdated: true,
      statusChanged: true,
      dueReminder: false,
    },
    leads: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newLead: true,
      leadStatusChanged: true,
    },
    calendar: {
      ...EMPTY_RECIPIENTS(),
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
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      stockIn: true,
      stockOut: true,
      productionStatusChanged: true,
    },
    attendance: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newWorkReports: true,
      payrollApproved: true,
      attendanceChanged: true,
      leaveRequestChanged: true,
    },
    messages: {
      ...EMPTY_RECIPIENTS(),
      enabled: true,
      newCustomerMessage: true,
      newInternalMessage: true,
    },
    system: {
      ...EMPTY_RECIPIENTS(),
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
      if (
        k === "useGlobalRecipients" ||
        k === "recipients" ||
        k === "recipientUserIds" ||
        k === "recipientEmployeeIds"
      ) {
        continue;
      }
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

function mergeRecipientFields(
  defaults: ModuleRecipientFields,
  raw: unknown
): ModuleRecipientFields {
  if (!isPlainObject(raw)) return { ...defaults };
  const r = raw as Record<string, unknown>;
  return {
    useGlobalRecipients:
      typeof r.useGlobalRecipients === "boolean" ? r.useGlobalRecipients : defaults.useGlobalRecipients,
    recipients: Array.isArray(r.recipients)
      ? r.recipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : defaults.recipients,
    recipientUserIds: Array.isArray(r.recipientUserIds)
      ? r.recipientUserIds.map((x) => String(x).trim()).filter(Boolean)
      : defaults.recipientUserIds,
    recipientEmployeeIds: Array.isArray(r.recipientEmployeeIds)
      ? r.recipientEmployeeIds.map((x) => String(x).trim()).filter(Boolean)
      : defaults.recipientEmployeeIds,
  };
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

  const r = raw as Record<string, unknown>;

  const globalRecipients = Array.isArray(r.globalRecipients)
    ? r.globalRecipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
    : Array.isArray(r.recipients)
      ? r.recipients.map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : d.globalRecipients;

  const globalRecipientUserIds = Array.isArray(r.globalRecipientUserIds)
    ? r.globalRecipientUserIds.map((x) => String(x).trim()).filter(Boolean)
    : d.globalRecipientUserIds;

  let globalRecipientEmployeeIds = Array.isArray(r.globalRecipientEmployeeIds)
    ? r.globalRecipientEmployeeIds.map((x) => String(x).trim()).filter(Boolean)
    : d.globalRecipientEmployeeIds;

  if (globalRecipientEmployeeIds.length === 0 && Array.isArray(r.recipientEmployeeIds)) {
    globalRecipientEmployeeIds = r.recipientEmployeeIds.map((x) => String(x).trim()).filter(Boolean);
  }
  if (
    globalRecipientEmployeeIds.length === 0 &&
    Array.isArray(r.recipientUserIds) &&
    !Array.isArray(r.globalRecipientUserIds)
  ) {
    const legacy = r.recipientUserIds.map((x) => String(x).trim()).filter(Boolean);
    if (legacy.length && !Array.isArray(r.globalRecipientUserIds)) {
      globalRecipientEmployeeIds = legacy;
    }
  }

  const includeOrganizationAdmins =
    typeof r.includeOrganizationAdmins === "boolean"
      ? r.includeOrganizationAdmins
      : d.includeOrganizationAdmins;

  const enabled = typeof r.enabled === "boolean" ? r.enabled : d.enabled;

  const mods = isPlainObject(r.modules) ? r.modules : {};

  function mergeMod<K extends EmailModuleKey>(key: K, rawMod: unknown): EmailNotificationsModules[K] {
    const def = d.modules[key];
    const merged = {
      ...mergeRecipientFields(def, rawMod),
      ...mergeFlags(def as unknown as Record<string, unknown>, rawMod),
    } as EmailNotificationsModules[K];
    if (key === "calendar") {
      (merged as CalendarEmailFlags).reminderOffsetsMinutes = normalizeOffsets(
        isPlainObject(rawMod)
          ? (rawMod as { reminderOffsetsMinutes?: unknown }).reminderOffsetsMinutes
          : undefined
      );
    }
    if (!isPlainObject(rawMod) || typeof (rawMod as ModuleRecipientFields).useGlobalRecipients !== "boolean") {
      (merged as ModuleRecipientFields).useGlobalRecipients = true;
    }
    return merged;
  }

  return {
    enabled,
    globalRecipients,
    globalRecipientUserIds,
    globalRecipientEmployeeIds,
    includeOrganizationAdmins,
    modules: {
      orders: mergeMod("orders", mods.orders),
      documents: mergeMod("documents", mods.documents),
      invoices: mergeMod("invoices", mods.invoices),
      leads: mergeMod("leads", mods.leads),
      calendar: mergeMod("calendar", mods.calendar),
      warehouse: mergeMod("warehouse", mods.warehouse),
      attendance: mergeMod("attendance", mods.attendance),
      messages: mergeMod("messages", mods.messages),
      system: mergeMod("system", mods.system),
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
