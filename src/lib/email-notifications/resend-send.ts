import { Resend } from "resend";

const LOG = "[email-notifications/resend]";

export type SendTransactionalEmailInput = {
  to: string[];
  subject: string;
  html: string;
};

export async function sendTransactionalEmail(
  input: SendTransactionalEmailInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.EMAIL_FROM ?? "").trim();
  if (!key || !from) {
    console.warn(LOG, "missing RESEND_API_KEY or EMAIL_FROM");
    return { ok: false, error: "E-mail není na serveru nakonfigurován." };
  }
  const uniqueTo = [...new Set(input.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (uniqueTo.length === 0) {
    return { ok: false, error: "Žádní příjemci." };
  }

  const resend = new Resend(key);
  const result = await resend.emails.send({
    from,
    to: uniqueTo,
    subject: input.subject,
    html: input.html,
  });

  if (result.error) {
    console.error(LOG, "Resend error", result.error);
    return { ok: false, error: "Odeslání e-mailu se nezdařilo." };
  }
  return { ok: true };
}

export function buildNotificationHtml(parts: {
  moduleLabel: string;
  title: string;
  lines: string[];
  actionUrl?: string | null;
  companyName?: string | null;
}): string {
  const when = new Date().toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
  const linesHtml = parts.lines
    .filter(Boolean)
    .map((l) => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`)
    .join("");
  const link =
    parts.actionUrl && parts.actionUrl.startsWith("http")
      ? `<p style="margin-top:16px;"><a href="${escapeHtml(parts.actionUrl)}">Otevřít v aplikaci</a></p>`
      : parts.actionUrl
        ? `<p style="margin-top:16px;"><a href="${escapeHtml(parts.actionUrl)}">Otevřít v aplikaci</a></p>`
        : "";

  return `
    <div style="font-family:system-ui,Segoe UI,sans-serif;font-size:15px;color:#111;line-height:1.45;max-width:560px;">
      ${parts.companyName ? `<p style="color:#666;font-size:13px;margin:0 0 8px;">${escapeHtml(parts.companyName)}</p>` : ""}
      <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#c2410c;">${escapeHtml(parts.moduleLabel)}</p>
      <h1 style="font-size:18px;margin:0 0 12px;">${escapeHtml(parts.title)}</h1>
      <p style="margin:0 0 8px;color:#444;font-size:13px;">${escapeHtml(when)}</p>
      ${linesHtml ? `<ul style="padding-left:20px;margin:8px 0;">${linesHtml}</ul>` : ""}
      ${link}
      <p style="margin-top:24px;font-size:12px;color:#888;">Toto je automatická zpráva z BizForge / Rajmondata.</p>
    </div>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
