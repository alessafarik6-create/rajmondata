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

export type PaymentAccountSource =
  | "override"
  | "contract"
  | "job"
  | "parent_invoice"
  | "organization"
  | "legacy"
  | null;

export type ResolvedBankSnapshot = {
  bankAccountId: string | null;
  bankAccountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  swift: string | null;
  /** Jednořádkový text pro patičku / box */
  displayPrimary: string;
  /** Název účtu z organizace (bankAccounts), pokud jde o výběr z kolekce */
  accountName: string | null;
  /** Odkud pochází účet pro QR / platební údaje */
  source: PaymentAccountSource;
};

/**
 * Rozparsuje „123456789/0100“, „19-123456789/0100“ nebo IBAN (CZ…).
 */
export function parsePaymentAccountString(raw: string | null | undefined): {
  accountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
} {
  const t = String(raw ?? "").trim();
  if (!t) return { accountNumber: null, bankCode: null, iban: null };
  const compact = t.replace(/\s+/g, "");
  const ibanCandidate = compact.replace(/\s/g, "").toUpperCase();
  if (/^CZ[0-9]{2}[0-9]{10,30}$/.test(ibanCandidate)) {
    return { accountNumber: null, bankCode: null, iban: ibanCandidate };
  }
  const parts = compact.split("/");
  if (parts.length >= 2) {
    const code = parts.pop()!.replace(/\s/g, "");
    const acc = parts.join("/").replace(/\s/g, "");
    if (/^\d{4}$/.test(code) && acc.length > 0) {
      return { accountNumber: acc, bankCode: code, iban: null };
    }
  }
  return { accountNumber: null, bankCode: null, iban: null };
}

/** MOD 97-10 pro číselný řetězec (IBAN kontrola / výpočet kontrolních číslic). */
function mod97NumericString(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return NaN;
    remainder = (remainder * 10 + d) % 97;
  }
  return remainder;
}

/** Přesune první 4 znaky na konec a převede písmena na číslice (ISO 13616). */
function ibanToExpandedNumeric(ibanRaw: string): string | null {
  const iban = ibanRaw.replace(/\s/g, "").toUpperCase();
  if (iban.length < 8) return null;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let out = "";
  for (let i = 0; i < rearranged.length; i++) {
    const ch = rearranged[i]!;
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (ch >= "A" && ch <= "Z") {
      out += String(ch.charCodeAt(0) - 55);
    } else {
      return null;
    }
  }
  return out;
}

export function validateIbanMod97(iban: string): boolean {
  const expanded = ibanToExpandedNumeric(iban);
  if (!expanded) return false;
  const r = mod97NumericString(expanded);
  return r === 1;
}

/**
 * Český účet → IBAN pro SPD (CZ + kontrolní číslice + 4× kód banky + 16× číslo účtu doplněné zleva nulami).
 * @param accountNumber např. "2192111088" nebo "19-2192111088"
 * @param bankCode 4 číslice, např. "5500"
 */
export function convertToIban(
  accountNumber: string | null | undefined,
  bankCode: string | null | undefined
): string | null {
  const code = String(bankCode ?? "").replace(/\s/g, "");
  if (!/^\d{4}$/.test(code)) return null;
  const digitsOnly = String(accountNumber ?? "").replace(/\D/g, "");
  if (!digitsOnly) return null;
  const stripped = digitsOnly.replace(/^0+/, "") || "0";
  if (stripped.length > 16) return null;
  const padded = stripped.padStart(16, "0");
  const bban = code + padded;
  const tmp = bban + "123500";
  const r = mod97NumericString(tmp);
  if (!Number.isFinite(r)) return null;
  const check = String(98 - r).padStart(2, "0");
  const iban = `CZ${check}${bban}`;
  return validateIbanMod97(iban) ? iban : null;
}

/** IBAN pro pole ACC ve SPD — vždy platný IBAN, nikdy tvar číslo/kód. */
function resolveIbanForPaymentQr(params: {
  iban?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
}): string | null {
  const existing = normalizeLine(params.iban).replace(/\s/g, "").toUpperCase();
  if (existing.length >= 15 && /^[A-Z]{2}\d{2}/.test(existing)) {
    if (validateIbanMod97(existing)) return existing;
  }
  const accRaw = normalizeLine(params.bankAccountNumber);
  const codeRaw = normalizeLine(params.bankCode);
  if (accRaw && codeRaw) {
    const fromParts = convertToIban(accRaw, codeRaw);
    if (fromParts) return fromParts;
  }
  if (accRaw && (accRaw.includes("/") || !codeRaw)) {
    const p = parsePaymentAccountString(accRaw);
    if (p.iban && validateIbanMod97(p.iban)) return p.iban.toUpperCase();
    if (p.accountNumber && p.bankCode) {
      const c = convertToIban(p.accountNumber, p.bankCode);
      if (c) return c;
    }
  }
  return null;
}

function resolvedFromParsedLine(
  parsed: ReturnType<typeof parsePaymentAccountString>,
  fallbackDisplay: string,
  source: PaymentAccountSource
): ResolvedBankSnapshot {
  const iban = parsed.iban || null;
  const acc = parsed.accountNumber || null;
  const code = parsed.bankCode || null;
  const display =
    iban != null
      ? `IBAN: ${iban}`
      : acc && code
        ? `${acc}/${code}`
        : fallbackDisplay.trim() || "—";
  return {
    bankAccountId: null,
    bankAccountNumber: acc,
    bankCode: code,
    iban,
    swift: null,
    displayPrimary: display,
    accountName: null,
    source,
  };
}

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

function finalizeBankSnapForQrDebug(snap: ResolvedBankSnapshot): ResolvedBankSnapshot {
  if (process.env.NODE_ENV === "development") {
    console.log("QR account source", snap);
    console.log("QR source type", snap.source);
  }
  return snap;
}

export type ResolvePaymentAccountInput = {
  bankAccounts: OrgBankAccountRow[];
  /** Ruční výběr účtu na faktuře / dokladu */
  overrideBankAccountId?: string | null;
  contract?: { bankAccountId?: string | null; bankAccountNumber?: string | null } | null;
  job?: { bankAccountId?: string | null; bankAccountNumber?: string | null } | null;
  /** bankAccountId uložený na navázané zálohové faktuře (daňový doklad) */
  parentDocumentBankAccountId?: string | null;
  legacyCompanyBankLine?: string | null;
};

/**
 * Jednotné rozlišení účtu pro QR a platební box (priorita viz `resolveBankAccountForInvoice`).
 */
export function resolvePaymentAccount(input: ResolvePaymentAccountInput): ResolvedBankSnapshot {
  return resolveBankAccountForInvoice({
    bankAccounts: input.bankAccounts,
    overrideBankAccountId: input.overrideBankAccountId,
    contractBankAccountId: input.contract?.bankAccountId,
    contractBankAccountNumber: input.contract?.bankAccountNumber,
    jobBankAccountId: input.job?.bankAccountId,
    jobBankAccountNumber: input.job?.bankAccountNumber,
    parentDocumentBankAccountId: input.parentDocumentBankAccountId,
    legacyCompanyBankLine: input.legacyCompanyBankLine,
  });
}

/**
 * Priorita: ruční výběr na dokladu → účet ze smlouvy (id / text) → účet zakázky (id / text)
 * → účet z navázaného dokladu (záloha) → výchozí účet organizace → legacy řádek firmy.
 */
export function resolveBankAccountForInvoice(params: {
  bankAccounts: OrgBankAccountRow[];
  contractBankAccountId?: string | null;
  contractBankAccountNumber?: string | null;
  jobBankAccountId?: string | null;
  jobBankAccountNumber?: string | null;
  parentDocumentBankAccountId?: string | null;
  overrideBankAccountId?: string | null;
  legacyCompanyBankLine?: string | null;
}): ResolvedBankSnapshot {
  const accounts = params.bankAccounts || [];
  const byId = (id: string | null | undefined) => {
    if (id == null || String(id).trim() === "") return null;
    return accounts.find((a) => a.id === String(id).trim()) ?? null;
  };

  let chosen: OrgBankAccountRow | null = null;
  let source: PaymentAccountSource = null;

  if (params.overrideBankAccountId) {
    chosen = byId(params.overrideBankAccountId);
    if (chosen) source = "override";
  }
  if (!chosen && params.contractBankAccountId) {
    chosen = byId(params.contractBankAccountId);
    if (chosen) source = "contract";
  }
  if (!chosen) {
    const cText = (params.contractBankAccountNumber || "").trim();
    if (cText) {
      const p = parsePaymentAccountString(cText);
      if (p.iban || (p.accountNumber && p.bankCode)) {
        return finalizeBankSnapForQrDebug(
          resolvedFromParsedLine(p, cText, "contract")
        );
      }
    }
  }
  if (!chosen && params.jobBankAccountId) {
    chosen = byId(params.jobBankAccountId);
    if (chosen) source = "job";
  }
  if (!chosen) {
    const jText = (params.jobBankAccountNumber || "").trim();
    if (jText) {
      const p = parsePaymentAccountString(jText);
      if (p.iban || (p.accountNumber && p.bankCode)) {
        return finalizeBankSnapForQrDebug(
          resolvedFromParsedLine(p, jText, "job")
        );
      }
    }
  }
  if (!chosen && params.parentDocumentBankAccountId) {
    chosen = byId(params.parentDocumentBankAccountId);
    if (chosen) source = "parent_invoice";
  }
  if (!chosen && accounts.length > 0) {
    chosen = pickDefaultAccount(accounts);
    if (chosen) source = "organization";
  }

  if (chosen) {
    const iban = (chosen.iban || "").trim();
    const swift = (chosen.swift || "").trim();
    const cz = formatCzechAccount(chosen);
    const displayPrimary = iban
      ? `IBAN: ${iban}${swift ? ` · SWIFT: ${swift}` : ""}`
      : cz || iban || (params.legacyCompanyBankLine || "").trim() || "—";
    const name = (chosen.name || "").trim() || null;
    return finalizeBankSnapForQrDebug({
      bankAccountId: chosen.id,
      bankAccountNumber: (chosen.accountNumber || "").trim() || null,
      bankCode: (chosen.bankCode || "").trim() || null,
      iban: iban || null,
      swift: swift || null,
      displayPrimary,
      accountName: name,
      source,
    });
  }

  const legacy = (params.legacyCompanyBankLine || "").trim();
  if (legacy) {
    const p = parsePaymentAccountString(legacy);
    if (p.iban || (p.accountNumber && p.bankCode)) {
      return finalizeBankSnapForQrDebug(
        resolvedFromParsedLine(p, legacy, "legacy")
      );
    }
  }

  const manual = (params.contractBankAccountNumber || "").trim();
  const jFall = (params.jobBankAccountNumber || "").trim();
  const line = manual || jFall || legacy;
  return finalizeBankSnapForQrDebug({
    bankAccountId: null,
    bankAccountNumber: null,
    bankCode: null,
    iban: null,
    swift: null,
    displayPrimary: line || "—",
    accountName: null,
    source: null,
  });
}

/** Text do HTML boxu „Platební údaje“ */
export function formatBankBlockPlainLines(snap: ResolvedBankSnapshot): string {
  const lines: string[] = [];
  const accName = (snap.accountName || "").trim();
  if (accName) {
    lines.push(`Účet: ${accName}`);
  }
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

/** Vytvoří SPD řetězec + URL QR obrázku, nebo warning pokud chybí povinné údaje. */
export function buildInvoicePaymentQr(params: {
  iban?: string | null;
  bankAccountNumber?: string | null;
  bankCode?: string | null;
  amountGross?: number | null;
  variableSymbol?: string | null;
  message?: string | null;
}): InvoiceQrSnapshot | null {
  const ibanForQr = resolveIbanForPaymentQr(params);
  const amount = Number(params.amountGross ?? 0);
  const vs = normalizeLine(params.variableSymbol);
  const msg = normalizeLine(params.message).slice(0, 60);
  const missing: string[] = [];
  if (!ibanForQr) missing.push("IBAN pro QR");
  if (!Number.isFinite(amount) || amount <= 0) missing.push("částka");
  if (!vs) missing.push("variabilní symbol");
  if (missing.length > 0) {
    const noIban = missing.includes("IBAN pro QR");
    const rest = missing.filter((m) => m !== "IBAN pro QR");
    let warning: string;
    if (noIban && rest.length === 0) {
      warning =
        "QR platbu nelze vytvořit — z čísla účtu se nepodařilo sestavit platný IBAN (zkontrolujte číslo účtu a kód banky).";
    } else if (noIban) {
      warning = `QR platbu nelze vytvořit — chybí platný IBAN pro SPD. Doplňte také: ${rest.join(", ")}.`;
    } else {
      warning = `QR platba nelze vytvořit (chybí: ${missing.join(", ")}).`;
    }
    return {
      spd: "",
      qrUrl: "",
      warning,
    };
  }
  const spdParts = [
    "SPD*1.0",
    `ACC:${ibanForQr}`,
    `AM:${amount.toFixed(2)}`,
    "CC:CZK",
    `X-VS:${vs}`,
    `MSG:${msg || vs}`,
  ];
  const spd = spdParts.join("*");
  if (process.env.NODE_ENV === "development") {
    console.log("QR IBAN", ibanForQr);
    console.log("QR payload", spd);
  }
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
    spd
  )}`;
  return { spd, qrUrl, warning: null };
}
