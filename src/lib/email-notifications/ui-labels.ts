import type { EmailModuleKey } from "./schema";

/** Popisky přepínačů událostí v nastavení (čeština). */
export const MODULE_EVENT_LABELS: Record<
  EmailModuleKey,
  { eventKey: string; label: string }[]
> = {
  orders: [
    { eventKey: "newOrder", label: "Nová zakázka" },
    { eventKey: "orderUpdated", label: "Úprava zakázky" },
    { eventKey: "orderStatusChanged", label: "Změna stavu zakázky" },
    { eventKey: "noteAdded", label: "Přidání poznámky" },
    { eventKey: "attachmentAdded", label: "Přidání souboru / média" },
  ],
  documents: [
    { eventKey: "newDocument", label: "Nový doklad" },
    { eventKey: "pendingAssignment", label: "Doklad k zařazení" },
    { eventKey: "updated", label: "Změna dokladu" },
    { eventKey: "approvedOrProcessed", label: "Schválení / zpracování dokladu" },
  ],
  invoices: [
    { eventKey: "newInvoice", label: "Nová faktura" },
    { eventKey: "invoiceUpdated", label: "Změna faktury" },
    { eventKey: "statusChanged", label: "Změna stavu faktury" },
    { eventKey: "dueReminder", label: "Blížící se / po splatnosti" },
  ],
  leads: [
    { eventKey: "newLead", label: "Nová poptávka" },
    { eventKey: "leadStatusChanged", label: "Změna stavu poptávky" },
  ],
  calendar: [
    { eventKey: "eventCreated", label: "Nový záznam" },
    { eventKey: "eventUpdated", label: "Změna záznamu" },
    { eventKey: "eventDeleted", label: "Smazání záznamu" },
    { eventKey: "reminderEnabled", label: "Připomenutí před schůzkou / událostí" },
    { eventKey: "todayEventReminder", label: "Upozornění na dnešní událost" },
  ],
  warehouse: [
    { eventKey: "stockIn", label: "Naskladnění" },
    { eventKey: "stockOut", label: "Vyskladnění" },
    { eventKey: "productionStatusChanged", label: "Změna stavu výroby" },
  ],
  attendance: [
    { eventKey: "newWorkReports", label: "Nové výkazy" },
    { eventKey: "payrollApproved", label: "Schválení výplat / výkazů" },
    { eventKey: "attendanceChanged", label: "Změna docházky" },
    { eventKey: "leaveRequestChanged", label: "Žádost / změna absence" },
  ],
  messages: [
    { eventKey: "newCustomerMessage", label: "Nová zpráva od zákazníka" },
    { eventKey: "newInternalMessage", label: "Nová interní zpráva" },
  ],
  system: [
    { eventKey: "importantDataChange", label: "Důležitá změna dat" },
    { eventKey: "importError", label: "Chyba importu" },
    { eventKey: "pendingItemsReminder", label: "Nevyřízené položky" },
  ],
};

export const MODULE_SECTION_TITLES: Record<EmailModuleKey, string> = {
  orders: "Zakázky",
  documents: "Doklady",
  invoices: "Faktury",
  leads: "Poptávky",
  calendar: "Kalendář",
  warehouse: "Sklady / výroba",
  attendance: "Práce a mzdy / docházka",
  messages: "Chat / zprávy",
  system: "Obecné systémové události",
};
