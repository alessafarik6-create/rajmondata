const MODULE_LABELS: Record<string, string> = {
  overview: "Přehled",
  jobs: "Zakázky",
  leads: "Poptávky",
  offers: "Nabídky",
  invoices: "Fakturace",
  finance: "Finance",
  bank: "Banka",
  documents: "Dokumenty",
  employees: "Zaměstnanci",
  customers: "Zákazníci",
  schedule: "Kalendář",
  labor: "Docházka",
  reports: "Reporty",
  settings: "Nastavení",
  aiCenter: "AI asistent",
  sklad: "Sklad",
  vyroba: "Výroba",
  emails: "E-mail",
  fleet: "GPS sledování",
  auth: "Přihlášení",
  unknown: "Portál",
};

export function moduleLabelCs(moduleId: string | null | undefined): string {
  const k = String(moduleId ?? "").trim();
  if (!k) return "Portál";
  return MODULE_LABELS[k] ?? k.replace(/_/g, " ");
}

export function liveEventLabelCs(input: {
  event: string;
  moduleId?: string | null;
  actionKey?: string | null;
  actionLabel?: string | null;
}): string {
  if (input.actionLabel?.trim()) return input.actionLabel.trim().slice(0, 300);
  const mod = moduleLabelCs(input.moduleId);
  switch (input.event) {
    case "login":
      return "Přihlášení do portálu";
    case "logout":
      return "Odhlášení z portálu";
    case "module_opened":
      return `Otevřel sekci ${mod}`;
    case "job_created":
      return "Vytvořil zakázku";
    case "job_status_changed":
      return "Změnil stav zakázky";
    case "lead_created":
      return "Vytvořil poptávku";
    case "offer_created":
      return "Vytvořil cenovou nabídku";
    case "invoice_issued":
      return "Vystavil fakturu";
    case "document_uploaded":
      return "Nahrál dokument";
    case "action_clicked":
      return input.actionKey ? `Akce: ${input.actionKey}` : `Akce v sekci ${mod}`;
    default:
      return input.event.replace(/_/g, " ");
  }
}
