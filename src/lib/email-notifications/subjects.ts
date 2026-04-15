import type { EmailModuleKey } from "./schema";

/** Předměty e-mailů podle modulu a typu události (česky). */
export function defaultSubjectForEvent(
  module: EmailModuleKey,
  eventKey: string
): string {
  const key = `${module}.${eventKey}`;
  const map: Record<string, string> = {
    "orders.newOrder": "Nová zakázka v systému",
    "orders.orderUpdated": "Zakázka byla upravena",
    "orders.orderStatusChanged": "Změna stavu zakázky",
    "orders.noteAdded": "Nová poznámka u zakázky",
    "orders.attachmentAdded": "Nový soubor u zakázky",
    "documents.newDocument": "Nový doklad",
    "documents.pendingAssignment": "Doklad k zařazení",
    "documents.updated": "Doklad byl upraven",
    "documents.approvedOrProcessed": "Doklad byl zpracován / schválen",
    "invoices.newInvoice": "Nová faktura",
    "invoices.invoiceUpdated": "Faktura byla upravena",
    "invoices.statusChanged": "Změna stavu faktury",
    "invoices.dueReminder": "Blížící se / po splatnosti faktury",
    "leads.newLead": "Nová poptávka",
    "leads.leadStatusChanged": "Změna stavu poptávky",
    "calendar.eventCreated": "Nová kalendářová událost",
    "calendar.eventUpdated": "Kalendářová událost byla upravena",
    "calendar.eventDeleted": "Kalendářová událost byla smazána",
    "calendar.reminder": "Připomenutí schůzky / události",
    "calendar.todayEventReminder": "Událost v kalendáři — dnes",
    "warehouse.stockIn": "Naskladnění",
    "warehouse.stockOut": "Vyskladnění",
    "warehouse.productionStatusChanged": "Změna stavu výroby",
    "attendance.newWorkReports": "Nový denní výkaz",
    "attendance.payrollApproved": "Výplata / výkaz schválen",
    "attendance.attendanceChanged": "Změna docházky",
    "attendance.leaveRequestChanged": "Žádost o absenci",
    "messages.newCustomerMessage": "Nová zpráva od zákazníka",
    "messages.newInternalMessage": "Nová interní zpráva",
    "system.importantDataChange": "Důležitá změna dat",
    "system.importError": "Chyba importu",
    "system.pendingItemsReminder": "Nevyřízené položky",
    "system.test": "Test e-mailových notifikací",
  };
  return map[key] || "Změna v systému";
}

export function moduleLabelCs(module: EmailModuleKey): string {
  const m: Record<EmailModuleKey, string> = {
    orders: "Zakázky",
    documents: "Doklady",
    invoices: "Faktury",
    leads: "Poptávky",
    calendar: "Kalendář",
    warehouse: "Sklady / výroba",
    attendance: "Práce a mzdy / docházka",
    messages: "Zprávy",
    system: "Systém",
  };
  return m[module];
}
