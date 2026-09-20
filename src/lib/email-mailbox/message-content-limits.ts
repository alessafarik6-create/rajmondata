/** Firestore dokument ~1 MiB — držíme těla výrazně pod limitem. */

export const EMAIL_TEXT_BODY_MAX_CHARS = 80_000;
export const EMAIL_HTML_BODY_MAX_CHARS = 120_000;
export const EMAIL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const EMAIL_SYNC_BATCH_SIZE = 25;
export const EMAIL_BOOTSTRAP_WINDOW = 100;

export function stripInlineDataUrlsFromHtml(html: string): string {
  return html.replace(/src\s*=\s*["']data:[^"']+["']/gi, 'src=""');
}

export function prepareTextBodyForFirestore(raw: string | null | undefined): {
  text: string | null;
  truncated: boolean;
} {
  if (!raw?.trim()) return { text: null, truncated: false };
  const t = raw.trim();
  if (t.length <= EMAIL_TEXT_BODY_MAX_CHARS) return { text: t, truncated: false };
  return {
    text: `${t.slice(0, EMAIL_TEXT_BODY_MAX_CHARS)}\n\n[… zkráceno kvůli velikosti …]`,
    truncated: true,
  };
}

export function prepareHtmlBodyForFirestore(raw: string | null | undefined): {
  html: string | null;
  truncated: boolean;
} {
  if (!raw?.trim()) return { html: null, truncated: false };
  let h = stripInlineDataUrlsFromHtml(raw.trim());
  if (h.length <= EMAIL_HTML_BODY_MAX_CHARS) return { html: h, truncated: false };
  h = h.slice(0, EMAIL_HTML_BODY_MAX_CHARS);
  return { html: `${h}\n<!-- truncated -->`, truncated: true };
}
