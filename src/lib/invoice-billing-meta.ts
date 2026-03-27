/**
 * Společná logika pro účetní doklady: účet, VS, odběratel.
 */

function variableSymbolFromInvoiceNumber(invoiceNumber: string): string {
  const d = invoiceNumber.replace(/\D/g, "");
  if (d.length >= 4) return d.slice(0, 10);
  return invoiceNumber.replace(/\s/g, "").slice(0, 20) || invoiceNumber;
}

export type OrgBankAccountRow = {
  id: string;
  name?: string | null;
  accountNumber?: string | null;
  bankCode?: string | null;
  iban?: string | null;
  swift?: string | null;
  isDefault?: boolean | null;
};

export type ResolvedBankSnapshot = {
  bankAccountId: string | null;
  bankAccountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  swift: string | null;
  /** Jednořádkový text pro patičku / box */
  displayPrimary: string;
};

function pickDefaultAccount(
  accounts: OrgBankAccountRow[]
): OrgBankAccountRow | null {
  if (!accounts.length) return null;
  const def = accounts.find((a) => a.isDefault === true);
  return def ?? accounts[0] ?? null;
}

function formatCzechAccount(a: OrgBankAccountRow): string {
  const acc = (a.accountNumber || "").trim();
  const code = (a.bankCode || "").trim();
  if (acc && code) return `${acc}/${code}`;
  return acc || "";
}

/**
 * Priorita: smlouva (bankAccountId / číslo) → výchozí účet organizace.
 * Ruční výběr předáváte jako overrideId.
 */
export function resolveBankAccountForInvoice(params: {
  bankAccounts: OrgBankAccountRow[];
  /** bankAccountId ze smlouvy o dílo */
  contractBankAccountId?: string | null;
  /** volitelné číslo účtu ze smlouvy (text) */
  contractBankAccountNumber?: string | null;
  /** výběr uživatele při vytvoření / editaci */
  overrideBankAccountId?: string | null;
  /** legacy řádek z company.bankAccountNumber */
  legacyCompanyBankLine?: string | null;
}): ResolvedBankSnapshot {
  const accounts = params.bankAccounts || [];
  const byId = (id: string | null | undefined) =>
    id ? accounts.find((a) => a.id === id) ?? null : null;

  let chosen: OrgBankAccountRow | null = null;

  if (params.overrideBankAccountId) {
    chosen = byId(params.overrideBankAccountId);
  }
  if (!chosen && params.contractBankAccountId) {
    chosen = byId(params.contractBankAccountId);
  }
  if (!chosen && accounts.length > 0) {
    chosen = pickDefaultAccount(accounts);
  }

  if (chosen) {
    const iban = (chosen.iban || "").trim();
    const swift = (chosen.swift || "").trim();
    const cz = formatCzechAccount(chosen);
    const displayPrimary = iban
      ? `IBAN: ${iban}${swift ? ` · SWIFT: ${swift}` : ""}`
      : cz || iban || (params.legacyCompanyBankLine || "").trim() || "—";
    return {
      bankAccountId: chosen.id,
      bankAccountNumber: (chosen.accountNumber || "").trim() || null,
      bankCode: (chosen.bankCode || "").trim() || null,
      iban: iban || null,
      swift: swift || null,
      displayPrimary,
    };
  }

  const legacy = (params.legacyCompanyBankLine || "").trim();
  const manual = (params.contractBankAccountNumber || "").trim();
  const line = manual || legacy;
  return {
    bankAccountId: null,
    bankAccountNumber: null,
    bankCode: null,
    iban: null,
    swift: null,
    displayPrimary: line || "—",
  };
}

/** Text do HTML boxu „Platební údaje“ */
export function formatBankBlockPlainLines(snap: ResolvedBankSnapshot): string {
  const lines: string[] = [];
  const iban = (snap.iban || "").trim();
  const swift = (snap.swift || "").trim();
  const acc = (snap.bankAccountNumber || "").trim();
  const code = (snap.bankCode || "").trim();
  if (iban) {
    lines.push(`IBAN: ${iban}`);
    if (swift) lines.push(`SWIFT: ${swift}`);
  } else if (acc && code) {
    lines.push(`Číslo účtu: ${acc}/${code}`);
  } else if (snap.displayPrimary && snap.displayPrimary !== "—") {
    lines.push(snap.displayPrimary);
  }
  return lines.join("\n");
}

/**
 * VS: číslo smlouvy (preferovaně číslice), jinak z čísla faktury.
 */
export function resolveInvoiceVariableSymbol(params: {
  contractNumber?: string | null;
  invoiceNumber: string;
}): string {
  const raw = (params.contractNumber ?? "").trim().replace(/\s+/g, " ");
  if (raw) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(0, 10);
    return raw.slice(0, 24);
  }
  return variableSymbolFromInvoiceNumber(params.invoiceNumber);
}

export type RecipientSnapshot = {
  customerName: string;
  customerAddressLines: string;
  customerIco: string | null;
  customerDic: string | null;
};

/** Odběratel: smlouva (contractor) → jméno zákazníka / zakázky */
export function resolveInvoiceRecipient(params: {
  contractContractor?: string | null;
  fallbackCustomerName: string;
  customerAddressLines: string;
  customerIco?: string | null;
  customerDic?: string | null;
}): RecipientSnapshot {
  const name =
    (params.contractContractor || "").trim() ||
    (params.fallbackCustomerName || "").trim() ||
    "Odběratel";
  return {
    customerName: name,
    customerAddressLines: params.customerAddressLines || name,
    customerIco: params.customerIco?.trim() || null,
    customerDic: params.customerDic?.trim() || null,
  };
}

export function formatSupplierPartyLines(params: {
  companyName: string;
  addressLines: string;
  ico?: string | null;
  dic?: string | null;
}): string {
  const parts = [params.companyName.trim(), params.addressLines.trim()].filter(
    Boolean
  );
  const ico = (params.ico || "").trim();
  const dic = (params.dic || "").trim();
  if (ico) parts.push(`IČO: ${ico}`);
  if (dic) parts.push(`DIČ: ${dic}`);
  return parts.join("\n");
}

export function formatCustomerPartyLines(
  name: string,
  addressMultiline: string,
  ico?: string | null,
  dic?: string | null
): string {
  const parts: string[] = [];
  const n = name.trim();
  if (n) parts.push(n);
  const addr = addressMultiline.trim();
  if (addr) parts.push(addr);
  const ic = (ico || "").trim();
  const di = (dic || "").trim();
  if (ic) parts.push(`IČO: ${ic}`);
  if (di) parts.push(`DIČ: ${di}`);
  return parts.join("\n");
}
