/**
 * Validace zákazníka při zakládání zakázky (veřejné testovatelné funkce).
 */

export type NewJobCustomerFieldErrors = Partial<
  Record<
    | "quickCustomerName"
    | "quickCustomerEmail"
    | "quickCustomerPhone"
    | "quickCustomerAddress",
    string
  >
>;

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

/** Minimálně 9 číslic po odstranění mezer a formátování. */
export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function validateCustomerEmail(email: string): string | null {
  const t = email.trim();
  if (!t) return "E-mail je povinný.";
  if (!EMAIL_RE.test(t)) return "Zadejte platný e-mail.";
  return null;
}

export function validateCustomerPhone(phone: string): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits.length) return "Telefon je povinný.";
  if (digits.length < 9) return "Telefon musí mít alespoň 9 číslic.";
  return null;
}

export function validateNewCustomerForJob(input: {
  name: string;
  email: string;
  phone: string;
  address: string;
}): NewJobCustomerFieldErrors {
  const errors: NewJobCustomerFieldErrors = {};
  if (!input.name.trim()) {
    errors.quickCustomerName = "Jméno, příjmení nebo název firmy je povinné.";
  }
  const emailErr = validateCustomerEmail(input.email);
  if (emailErr) errors.quickCustomerEmail = emailErr;
  const phoneErr = validateCustomerPhone(input.phone);
  if (phoneErr) errors.quickCustomerPhone = phoneErr;
  if (!input.address.trim()) {
    errors.quickCustomerAddress = "Adresa zákazníka je povinná.";
  }
  return errors;
}

export function hasFieldErrors(errors: NewJobCustomerFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
