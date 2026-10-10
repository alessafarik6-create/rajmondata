import { buildNotificationHtml, sendTransactionalEmail } from "@/lib/email-notifications/resend-send";

export async function sendEmployeePortalInviteEmail(input: {
  to: string;
  firstName: string;
  companyName: string;
  loginUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const subject = `${input.companyName} — přístup do RAJMONDATA`;
  const html = buildNotificationHtml({
    moduleLabel: "RAJMONDATA",
    title: "Vítejte v RAJMONDATA",
    companyName: input.companyName,
    lines: [
      `Dobrý den${input.firstName ? `, ${input.firstName}` : ""},`,
      `administrátor vám vytvořil přístup do firemního portálu ${input.companyName}.`,
      "Přihlaste se e-mailem a heslem, které vám sdělil administrátor (nebo které jste zvolili při vytváření účtu).",
    ],
    actionUrl: input.loginUrl,
  });

  const sent = await sendTransactionalEmail({ to: [input.to], subject, html });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}
