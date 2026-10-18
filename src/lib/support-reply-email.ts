function appBaseUrl(): string {
  return (
    String(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "") ||
    "https://rajmondata.cz"
  );
}

export function buildSupportReplyEmailHtml(input: {
  organizationName: string;
  subject: string;
  previewText: string;
  ticketId: string;
}): string {
  const url = `${appBaseUrl()}/portal/help/${encodeURIComponent(input.ticketId)}`;
  const preview = input.previewText.slice(0, 280).replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="cs"><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e2e8f0">
    <p style="margin:0 0 12px;font-size:14px;color:#334155">Dobrý den,</p>
    <p style="margin:0 0 12px;font-size:14px;color:#334155">
      tým podpory RAJMONDATA odpověděl na váš dotaz <strong>${input.subject.replace(/</g, "&lt;")}</strong>
      (${input.organizationName.replace(/</g, "&lt;")}).
    </p>
    <blockquote style="margin:16px 0;padding:12px 16px;background:#f1f5f9;border-left:4px solid #f97316;font-size:14px;color:#475569">
      ${preview}${input.previewText.length > 280 ? "…" : ""}
    </blockquote>
    <p style="margin:24px 0 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#f97316;color:#000;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:6px">
        Zobrazit odpověď
      </a>
    </p>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">
      Po přihlášení do portálu uvidíte celou konverzaci. Tento e-mail je servisní oznámení, ne marketing.
    </p>
  </div>
</body></html>`;
}

export function supportReplyEmailSubject(ticketSubject: string): string {
  const sub = ticketSubject.trim().slice(0, 120);
  return `RAJMONDATA – Máte novou odpověď od podpory${sub ? `: ${sub}` : ""}`.slice(0, 200);
}
