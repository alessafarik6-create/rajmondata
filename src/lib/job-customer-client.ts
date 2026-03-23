/**
 * Jednotná logika zobrazení zákazníka u zakázky a ve Smlouvě o dílo,
 * když zakázka nemá navázaný dokument zákazníka (např. vznikla ze zaměření).
 */

/**
 * Bezpečně vrátí DIČ z objektu firmy / zákazníka (Firestore, ARES apod. používají
 * různé klíče: dic, DIČ, …). Při null/undefined nebo chybějícím poli vrátí "".
 */
export function pickEntityDic(entity: unknown): string {
  if (entity == null || typeof entity !== "object") return "";
  const o = entity as Record<string, unknown>;
  const raw = o.dic ?? o.DIČ ?? o.DIC ?? o["dič"];
  if (raw == null) return "";
  const s = String(raw).trim();
  return s;
}

export function deriveCustomerDisplayNameFromJob(job: {
  customerName?: string | null;
}): string {
  return String(job?.customerName ?? "").trim();
}

/** Stejný formát jako deriveClientText(customer) v detailu zakázky — řádky v pevném pořadí. */
export function buildClientTextFromJobSnapshot(job: {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
}): string {
  const name = deriveCustomerDisplayNameFromJob(job);
  const address = String(job.customerAddress ?? "").trim();
  const ico = "";
  const dic = "";
  const email = job.customerEmail ? `Email: ${job.customerEmail}` : "";
  const phone = job.customerPhone ? `Telefon: ${job.customerPhone}` : "";
  return [name, address, ico, dic, email, phone].filter(Boolean).join("\n");
}

/** Jednoduchá detekce právnické osoby podle názvu (stejná heuristika pro jméno/příjmení vs. firma). */
export function looksLikeCompanyName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return false;
  return /\b(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|v\.?\s*o\.?\s*s\.?|s\.?\s*p\.?\s*z\.?\s*o\.?|k\.?\s*s\.?|o\.?\s*p\.?\s*z\.?|spol\.|ltd|s\.r\.o\.)\b/i.test(
    n
  );
}

/**
 * Rozdělení zobrazovaného jména pro fyzickou osobu (první token = jméno, zbytek = příjmení).
 * U firemního názvu vrací companyName a prázdné jméno/příjmení.
 */
export function parseCustomerNameForParty(name: string):
  | { type: "company"; companyName: string; firstName: string; lastName: string }
  | { type: "person"; firstName: string; lastName: string; companyName: string } {
  const t = name.trim();
  if (!t) {
    return { type: "person", firstName: "", lastName: "", companyName: "" };
  }
  if (looksLikeCompanyName(t)) {
    return { type: "company", companyName: t, firstName: "", lastName: "" };
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { type: "person", firstName: parts[0], lastName: "", companyName: "" };
  }
  return {
    type: "person",
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
    companyName: "",
  };
}
