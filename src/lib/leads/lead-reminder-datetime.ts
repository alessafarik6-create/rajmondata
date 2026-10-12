import { LEADS_APP_TIMEZONE, ymdInLeadsTimezone } from "@/lib/leads/lead-received-date";

export type LeadReminderQuickPresetId =
  | "15m"
  | "30m"
  | "1h"
  | "today_11"
  | "tomorrow_9";

/** yyyy-MM-dd pro `<input type="date">` v kalendářním dni Europe/Prague. */
export function pragueTodayYmd(now = new Date()): string {
  return ymdInLeadsTimezone(now);
}

export function pragueTomorrowYmd(now = new Date()): string {
  const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return ymdInLeadsTimezone(d);
}

/**
 * Sestaví Date z kalendářního data a času.
 * Pro uživatele v ČR odpovídá Europe/Prague (stejný model jako schůzky u poptávek).
 */
export function localDateTimeFromParts(dateYmd: string, hour: number, minute: number): Date | null {
  const ymd = String(dateYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const h = Math.min(23, Math.max(0, hour));
  const m = Math.min(59, Math.max(0, minute));
  const d = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveLeadReminderQuickPreset(
  preset: LeadReminderQuickPresetId,
  now = new Date()
): Date {
  switch (preset) {
    case "15m":
      return new Date(now.getTime() + 15 * 60 * 1000);
    case "30m":
      return new Date(now.getTime() + 30 * 60 * 1000);
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "today_11": {
      let d = localDateTimeFromParts(pragueTodayYmd(now), 11, 0)!;
      if (d.getTime() <= now.getTime()) {
        d = localDateTimeFromParts(pragueTomorrowYmd(now), 11, 0)!;
      }
      return d;
    }
    case "tomorrow_9":
      return localDateTimeFromParts(pragueTomorrowYmd(now), 9, 0)!;
    default:
      return new Date(now.getTime() + 30 * 60 * 1000);
  }
}

export function formatRemindAtPrague(d: Date): string {
  return d.toLocaleString("cs-CZ", {
    timeZone: LEADS_APP_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRemindTimePrague(d: Date): string {
  return d.toLocaleString("cs-CZ", {
    timeZone: LEADS_APP_TIMEZONE,
    timeStyle: "short",
  });
}
