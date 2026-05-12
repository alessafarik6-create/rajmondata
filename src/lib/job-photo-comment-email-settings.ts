/**
 * Nastavení e-mailových upozornění na nepřečtené poznámky u souborů ve fotodokumentaci (chat u souboru).
 * Ukládá se na dokument `users/{uid}`.
 */

/** Hodiny mezi opakovanými upozorněními; `0` = pouze jedno upozornění na thread, dokud zpráva není přečtena. */
export const UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS = [
  1, 3, 6, 10, 24, 48, 0,
] as const;

export type UnreadPhotoNoteIntervalHours =
  (typeof UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS)[number];

export function normalizeUnreadPhotoNoteIntervalHours(
  raw: unknown
): UnreadPhotoNoteIntervalHours {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : NaN;
  if (UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS.includes(n as UnreadPhotoNoteIntervalHours)) {
    return n as UnreadPhotoNoteIntervalHours;
  }
  return 24;
}

/** Výchozí: zapnuto (pole chybí = zapnuto). */
export function photoDocUnreadEmailEnabled(
  user: Record<string, unknown> | undefined
): boolean {
  if (!user) return true;
  if (user.emailUnreadPhotoNoteNotificationsEnabled === false) return false;
  return true;
}

/** Obecné upozornění na chat u zakázky (targetType job) — stávající přepínač. */
export function jobChatEmailEnabled(
  user: Record<string, unknown> | undefined
): boolean {
  if (!user) return true;
  if (user.emailMessageNotificationsEnabled === false) return false;
  return true;
}

export function unreadPhotoNoteIntervalHours(
  user: Record<string, unknown> | undefined
): UnreadPhotoNoteIntervalHours {
  return normalizeUnreadPhotoNoteIntervalHours(user?.unreadNoteNotificationIntervalHours);
}

/**
 * Vrací ms mezi opakovanými e-maily, nebo `"once"` = po prvním odeslání už neopakovat, dokud nepřečteno.
 */
export function unreadPhotoNoteIntervalMode(
  user: Record<string, unknown> | undefined
): { kind: "repeat"; ms: number } | { kind: "once" } {
  const h = unreadPhotoNoteIntervalHours(user);
  if (h === 0) return { kind: "once" };
  return { kind: "repeat", ms: h * 60 * 60 * 1000 };
}

export function shouldThrottleFileThreadEmail(params: {
  lastSentMs: number;
  mode: ReturnType<typeof unreadPhotoNoteIntervalMode>;
}): boolean {
  const { lastSentMs, mode } = params;
  if (!lastSentMs) return false;
  if (mode.kind === "once") return true;
  return Date.now() - lastSentMs < mode.ms;
}

/** Popisek intervalu pro UI (čeština). `0` = bez opakování do přečtení. */
export function unreadPhotoNoteIntervalLabelCs(h: UnreadPhotoNoteIntervalHours): string {
  switch (h) {
    case 1:
      return "1 hodina";
    case 3:
      return "3 hodiny";
    case 6:
      return "6 hodin";
    case 10:
      return "10 hodin";
    case 24:
      return "24 hodin";
    case 48:
      return "48 hodin";
    case 0:
      return "Vypnuto (bez opakování)";
    default:
      return `${h} hodin`;
  }
}

export function buildPhotoCommentDeepLinkQuery(
  folderId: string | null,
  fileId: string,
  fileName: string | null
): string {
  const payload = `${folderId ?? ""}\t${fileId}\t${fileName ?? ""}`;
  return `?photoComment=${encodeURIComponent(payload)}`;
}

export function parsePhotoCommentQueryParam(raw: string | null): {
  folderId: string;
  fileId: string;
  fileName: string;
} | null {
  if (!raw || !String(raw).trim()) return null;
  try {
    const dec = decodeURIComponent(String(raw).trim());
    const parts = dec.split("\t");
    const folderId = parts[0] ?? "";
    const fileId = parts[1] ?? "";
    const fileName = parts[2] ?? "";
    if (!fileId) return null;
    return { folderId, fileId, fileName };
  } catch {
    return null;
  }
}
