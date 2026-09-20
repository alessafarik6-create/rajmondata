/** Bezpečný timeout pro IMAP sync — zabrání věčnému stavu „syncing“. */
export const EMAIL_IMAP_SYNC_TIMEOUT_MS = 90_000;

export class EmailSyncTimeoutError extends Error {
  constructor() {
    super("IMAP synchronizace překročila časový limit.");
    this.name = "EmailSyncTimeoutError";
  }
}

export async function withEmailSyncTimeout<T>(
  promise: Promise<T>,
  ms: number = EMAIL_IMAP_SYNC_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new EmailSyncTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Účet zůstal ve stavu syncing déle než tento interval → považovat za zaseklý. */
export const EMAIL_SYNC_STALE_MS = 12 * 60 * 1000;

export function isEmailSyncStateStale(updatedAt: unknown): boolean {
  try {
    const v = updatedAt as { toMillis?: () => number; toDate?: () => Date } | string | null;
    let ms = 0;
    if (v && typeof v === "object" && typeof v.toMillis === "function") {
      ms = v.toMillis();
    } else if (v && typeof v === "object" && typeof v.toDate === "function") {
      ms = v.toDate().getTime();
    } else if (typeof v === "string") {
      ms = Date.parse(v);
    }
    if (!ms || Number.isNaN(ms)) return true;
    return Date.now() - ms > EMAIL_SYNC_STALE_MS;
  } catch {
    return true;
  }
}
