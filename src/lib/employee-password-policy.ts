/** Minimální délka hesla pro zaměstnance (shodně klient + Firebase Admin API). */
export const MIN_EMPLOYEE_PASSWORD_LENGTH = 6;

export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
    return `Heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`;
  }
  return null;
}
