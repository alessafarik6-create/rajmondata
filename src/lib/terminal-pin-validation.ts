/** Minimální délka PINu pro docházkový terminál (číslice). */
export const MIN_TERMINAL_PIN_LENGTH = 4;
/** Maximální délka PINu (číslice). */
export const MAX_TERMINAL_PIN_LENGTH = 12;

export function validateTerminalPinFormat(pin: string): string | null {
  const p = pin.trim();
  if (!p) return "Zadejte PIN.";
  if (!/^\d+$/.test(p)) {
    return "PIN smí obsahovat pouze číslice (0–9).";
  }
  if (p.length < MIN_TERMINAL_PIN_LENGTH) {
    return `PIN musí mít alespoň ${MIN_TERMINAL_PIN_LENGTH} číslice.`;
  }
  if (p.length > MAX_TERMINAL_PIN_LENGTH) {
    return `PIN může mít nejvýše ${MAX_TERMINAL_PIN_LENGTH} číslic.`;
  }
  return null;
}

export function generateRandomTerminalPin(digits = 4): string {
  const n = Math.max(MIN_TERMINAL_PIN_LENGTH, Math.min(digits, MAX_TERMINAL_PIN_LENGTH));
  let s = "";
  for (let i = 0; i < n; i++) {
    s += Math.floor(Math.random() * 10).toString();
  }
  return s;
}
