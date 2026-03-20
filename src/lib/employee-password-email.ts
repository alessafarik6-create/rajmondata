/**
 * Budoucí odeslání e-mailu po změně hesla administrátorem.
 * Po napojení na Resend / SendGrid / Firebase Extensions zde zavolejte API.
 */
export type AdminPasswordResetEmailParams = {
  toEmail: string;
  employeeDisplayName: string;
  companyName?: string | null;
};

export async function sendAdminPasswordResetNotification(
  _params: AdminPasswordResetEmailParams
): Promise<{ sent: boolean; skippedReason?: string }> {
  // TODO: implementace odeslání (např. transactional email)
  return { sent: false, skippedReason: "not_configured" };
}
