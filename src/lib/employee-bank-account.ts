/**
 * Bankovní údaje zaměstnance pro výplatu (companies/.../employees).
 * Validace CZ účtu + volitelný IBAN; maskování pro veřejné přehledy.
 */

export type EmployeeBankAccount = {
  accountNumber: string;
  bankCode: string;
  iban: string;
  bic: string;
  paymentNote: string;
};

export const EMPTY_EMPLOYEE_BANK_ACCOUNT: EmployeeBankAccount = {
  accountNumber: "",
  bankCode: "",
  iban: "",
  bic: "",
  paymentNote: "",
};

export function parseBankAccountFromFirestore(
  raw: unknown
): EmployeeBankAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    accountNumber:
      typeof o.accountNumber === "string" ? o.accountNumber.trim() : "",
    bankCode: typeof o.bankCode === "string" ? o.bankCode.trim() : "",
    iban: typeof o.iban === "string" ? o.iban.trim() : "",
    bic: typeof o.bic === "string" ? o.bic.trim() : "",
    paymentNote:
      typeof o.paymentNote === "string" ? o.paymentNote.trim() : "",
  };
}

/** Pro budoucí modul výplat / exportů — čistý přístup k uloženým datům. */
export function getEmployeeBankAccountForPayroll(
  employeeDoc: Record<string, unknown> | null | undefined
): EmployeeBankAccount | null {
  const b = parseBankAccountFromFirestore(employeeDoc?.bankAccount);
  if (!b) return null;
  const has =
    b.accountNumber ||
    b.bankCode ||
    b.iban ||
    b.bic ||
    b.paymentNote;
  return has ? b : null;
}

function stripSpaces(s: string): string {
  return s.replace(/\s/g, "");
}

/**
 * Rozdělí vstup typu "123456789/0100" nebo "19-123456789/0100".
 * Pokud je v accountRaw už /kód a bankCodeRaw prázdný, kód se převezme z řetězce.
 */
export function splitCzechAccountInput(
  accountRaw: string,
  bankCodeRaw: string
): { accountNumber: string; bankCode: string } {
  let acc = stripSpaces(accountRaw).trim();
  let code = stripSpaces(bankCodeRaw).trim();
  const m = acc.match(/^(.+?)\/(\d{4})$/);
  if (m && !code) {
    acc = m[1].trim();
    code = m[2];
  }
  return { accountNumber: acc, bankCode: code };
}

/** Číslo účtu (předčíslí-číslo): povoleny číslice a jedna pomlčka. */
export function isValidCzechAccountNumberPart(part: string): boolean {
  const s = stripSpaces(part).trim();
  if (!s) return false;
  return /^(?:\d{1,6}-)?\d{2,10}$/.test(s);
}

export function isValidCzechBankCode(code: string): boolean {
  const c = stripSpaces(code).trim();
  return /^\d{4}$/.test(c);
}

/** Modulo 97 kontrola IBAN (bez mezer). */
export function isValidIban(iban: string): boolean {
  const s = stripSpaces(iban).toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let expanded = "";
  for (const c of rearranged) {
    if (c >= "A" && c <= "Z") expanded += String(c.charCodeAt(0) - 55);
    else expanded += c;
  }
  let remainder = 0;
  for (let i = 0; i < expanded.length; i++) {
    const d = expanded.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    remainder = (remainder * 10 + d) % 97;
  }
  return remainder === 1;
}

export function isValidBic(bic: string): boolean {
  const s = stripSpaces(bic).toUpperCase();
  if (!s) return true;
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s);
}

export type BankAccountValidationResult =
  | { ok: true; normalized: EmployeeBankAccount }
  | { ok: false; message: string };

/**
 * Povolí prázdný výsledek (smazání údajů) nebo konzistentní CZ účet a/nebo IBAN.
 */
export function validateEmployeeBankAccountInput(input: {
  accountNumber: string;
  bankCode: string;
  iban: string;
  bic: string;
  paymentNote: string;
}): BankAccountValidationResult {
  const note = input.paymentNote.trim();
  const iban = stripSpaces(input.iban).toUpperCase();
  const bic = stripSpaces(input.bic).toUpperCase();
  const { accountNumber: accRaw, bankCode: codeRaw } = splitCzechAccountInput(
    input.accountNumber,
    input.bankCode
  );

  const hasAny =
    accRaw || codeRaw || iban || bic || note;
  if (!hasAny) {
    return {
      ok: true,
      normalized: { ...EMPTY_EMPLOYEE_BANK_ACCOUNT },
    };
  }

  if (iban) {
    if (!isValidIban(iban)) {
      return { ok: false, message: "IBAN není platný (zkontrolujte číslo)." };
    }
  }

  if (bic && !isValidBic(bic)) {
    return {
      ok: false,
      message: "BIC/SWIFT má mít 8 nebo 11 znaků (písmena a číslice).",
    };
  }

  if (!iban) {
    if (!accRaw || !codeRaw) {
      return {
        ok: false,
        message:
          "Vyplňte číslo účtu a kód banky (4 číslice), nebo zadejte platný IBAN.",
      };
    }
    if (!isValidCzechBankCode(codeRaw)) {
      return {
        ok: false,
        message: "Kód banky musí mít přesně 4 číslice.",
      };
    }
    if (!isValidCzechAccountNumberPart(accRaw)) {
      return {
        ok: false,
        message:
          "Číslo účtu: použijte číslice, volitelně předčíslí (např. 19-123456789).",
      };
    }
  } else {
    if (accRaw || codeRaw) {
      if (accRaw && !isValidCzechAccountNumberPart(accRaw)) {
        return {
          ok: false,
          message: "Číslo účtu (CZ) není ve platném tvaru.",
        };
      }
      if (codeRaw && !isValidCzechBankCode(codeRaw)) {
        return {
          ok: false,
          message: "Kód banky musí mít 4 číslice.",
        };
      }
    }
  }

  return {
    ok: true,
    normalized: {
      accountNumber: accRaw,
      bankCode: codeRaw,
      iban,
      bic: bic,
      paymentNote: note,
    },
  };
}

/** Maskovaný účet pro seznamy (např. hvězdičky + kód banky) nebo zkrácený IBAN. */
export function maskBankAccountForListDisplay(
  bank: EmployeeBankAccount | null | undefined
): string {
  if (!bank) return "—";
  const code = stripSpaces(bank.bankCode).trim();
  if (bank.iban) {
    const i = stripSpaces(bank.iban).toUpperCase();
    if (i.length <= 8) return "****";
    return `${i.slice(0, 4)}…${i.slice(-4)}`;
  }
  if (code) {
    return `*****/${code}`;
  }
  const acc = stripSpaces(bank.accountNumber).trim();
  if (acc) {
    return "****";
  }
  return "—";
}
