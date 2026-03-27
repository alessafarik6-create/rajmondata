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
  customerPhone: string | null;
  customerEmail: string | null;
  customerIco: string | null;
  customerDic: string | null;
};

function normalizeLine(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function parseCustomerBlock(block: string): RecipientSnapshot {
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const name = lines[0] || "Odběratel";
  let phone: string | null = null;
  let email: string | null = null;
  let ico: string | null = null;
  let dic: string | null = null;
  const addressLines: string[] = [];
  for (const l of lines.slice(1)) {
    const low = l.toLowerCase();
    if (!email && /@/.test(l)) {
      email = l.replace(/^e-?mail:\s*/i, "").trim() || null;
      continue;
    }
    if (!phone && (low.startsWith("tel") || low.startsWith("telefon"))) {
      phone = l.replace(/^tel(?:efon)?\.?:?\s*/i, "").trim() || null;
      continue;
    }
    if (!ico && low.startsWith("ičo")) {
      ico = l.replace(/^ičo:?\s*/i, "").trim() || null;
      continue;
    }
    if (!dic && low.startsWith("dič")) {
      dic = l.replace(/^dič:?\s*/i, "").trim() || null;
      continue;
    }
    addressLines.push(l);
  }
  return {
    customerName: name,
    customerAddressLines: addressLines.join("\n").trim(),
    customerPhone: phone,
    customerEmail: email,
    customerIco: ico,
    customerDic: dic,
  };
}

/** Odběratel: SOD objednatel → zákazník ze zakázky → ruční fallback; nikdy dodavatel. */
export function resolveInvoiceRecipient(params: {
  contractCustomerBlock?: string | null;
  fallbackCustomerName: string;
  customerAddressLines?: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  manualCustomerName?: string | null;
  manualCustomerAddressLines?: string | null;
  manualCustomerPhone?: string | null;
  manualCustomerEmail?: string | null;
  supplierNameToAvoid?: string | null;
}): RecipientSnapshot {
  const supplierName = normalizeLine(params.supplierNameToAvoid).toLowerCase();
  const fromContract = normalizeLine(params.contractCustomerBlock);
  if (fromContract) {
    const parsed = parseCustomerBlock(fromContract);
    if (parsed.customerName.trim().toLowerCase() !== supplierName) {
      return {
        customerName: parsed.customerName,
        customerAddressLines:
          parsed.customerAddressLines || parsed.customerName,
        customerPhone: parsed.customerPhone,
        customerEmail: parsed.customerEmail,
        customerIco:
          parsed.customerIco ?? (params.customerIco?.trim() || null),
        customerDic:
          parsed.customerDic ?? (params.customerDic?.trim() || null),
      };
    }
  }
  const fallbackName = normalizeLine(params.fallbackCustomerName);
  if (fallbackName && fallbackName.toLowerCase() !== supplierName) {
    return {
      customerName: fallbackName,
      customerAddressLines:
        normalizeLine(params.customerAddressLines) || fallbackName,
      customerPhone: normalizeLine(params.customerPhone) || null,
      customerEmail: normalizeLine(params.customerEmail) || null,
      customerIco: params.customerIco?.trim() || null,
      customerDic: params.customerDic?.trim() || null,
    };
  }
  const manualName = normalizeLine(params.manualCustomerName);
  const name =
    (manualName && manualName.toLowerCase() !== supplierName && manualName) ||
    "Odběratel";
  return {
    customerName: name,
    customerAddressLines:
      normalizeLine(params.manualCustomerAddressLines) || name,
    customerPhone: normalizeLine(params.manualCustomerPhone) || null,
    customerEmail: normalizeLine(params.manualCustomerEmail) || null,
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
  phone?: string | null,
  email?: string | null,
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
  const ph = (phone || "").trim();
  const em = (email || "").trim();
  if (ph) parts.push(`Tel: ${ph}`);
  if (em) parts.push(`E-mail: ${em}`);
  if (ic) parts.push(`IČO: ${ic}`);
  if (di) parts.push(`DIČ: ${di}`);
  return parts.join("\n");
}

export type InvoiceQrSnapshot = {
  spd: string;
  qrUrl: string;
  warning: string | null;
};

function normalizePaymentAccount(params: {
  iban?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
}): string | null {
  const iban = normalizeLine(params.iban).replace(/\s+/g, "");
  if (iban) return iban;
  const acc = normalizeLine(params.bankAccountNumber).replace(/\s+/g, "");
  const code = normalizeLine(params.bankCode).replace(/\s+/g, "");
  if (acc && code) return `${acc}/${code}`;
  return null;
}

/** Vytvoří SPD řetězec + URL QR obrázku, nebo warning pokud chybí povinné údaje. */
export function buildInvoicePaymentQr(params: {
  iban?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  amountGross?: number | null;
  variableSymbol?: string | null;
  message?: string | null;
}): InvoiceQrSnapshot | null {
  const acc = normalizePaymentAccount(params);
  const amount = Number(params.amountGross ?? 0);
  const vs = normalizeLine(params.variableSymbol);
  const msg = normalizeLine(params.message).slice(0, 60);
  const missing: string[] = [];
  if (!acc) missing.push("číslo účtu");
  if (!Number.isFinite(amount) || amount <= 0) missing.push("částka");
  if (!vs) missing.push("variabilní symbol");
  if (missing.length > 0) {
    return {
      spd: "",
      qrUrl: "",
      warning: `QR platba nelze vytvořit (chybí: ${missing.join(", ")}).`,
    };
  }
  const spdParts = [
    "SPD*1.0",
    `ACC:${acc}`,
    `AM:${amount.toFixed(2)}`,
    "CC:CZK",
    `X-VS:${vs}`,
    `MSG:${msg || vs}`,
  ];
  const spd = spdParts.join("*");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
    spd
  )}`;
  return { spd, qrUrl, warning: null };
}
