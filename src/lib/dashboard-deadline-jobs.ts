/**
 * Zakázky s blízkým termínem dokončení pro admin dashboard (pole job.endDate).
 */

/** Zakázky s termínem do N kalendářních dnů včetně (nebo po termínu) se zobrazí ve widgetu. */
export const UPCOMING_JOB_DEADLINE_WITHIN_DAYS = 30;

/** Do této hranice (dnů do termínu) je stupeň „kritický“ (červená). */
export const UPCOMING_JOB_DEADLINE_CRITICAL_DAYS = 3;

/** Do této hranice je stupeň „brzy“ (oranžová). */
export const UPCOMING_JOB_DEADLINE_SOON_DAYS = 14;

const TERMINAL_JOB_STATUSES = new Set(["dokončená", "fakturována"]);

export function isJobOpenForDeadlineWidget(job: { status?: string }): boolean {
  const s = String(job.status ?? "").toLowerCase().trim();
  return !TERMINAL_JOB_STATUSES.has(s);
}

export function parseJobDeadlineLocalDay(iso: string): Date | null {
  const t = String(iso).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** Rozdíl kalendářních dnů: kladné = dní do termínu, záporné = po termínu. */
export function calendarDaysUntilJobDeadline(
  endDateIso: string,
  now = new Date()
): number | null {
  const end = parseJobDeadlineLocalDay(endDateIso);
  if (!end) return null;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endStart = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round(
    (endStart.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000)
  );
}

export type DeadlineUrgency = "overdue" | "critical" | "soon" | "upcoming";

export function deadlineUrgency(daysUntil: number): DeadlineUrgency {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= UPCOMING_JOB_DEADLINE_CRITICAL_DAYS) return "critical";
  if (daysUntil <= UPCOMING_JOB_DEADLINE_SOON_DAYS) return "soon";
  return "upcoming";
}

export function deadlineUrgencyRowClass(u: DeadlineUrgency): string {
  switch (u) {
    case "overdue":
    case "critical":
      return "border-l-4 border-l-destructive bg-destructive/5";
    case "soon":
      return "border-l-4 border-l-amber-500 bg-amber-500/5";
    default:
      return "border-l-4 border-l-border bg-muted/30";
  }
}

export type JobWithDeadlineMeta<T> = T & {
  daysUntil: number;
  urgency: DeadlineUrgency;
};

export function selectUpcomingDeadlineJobs<T extends { endDate?: string; status?: string }>(
  jobs: T[] | null | undefined,
  opts?: {
    now?: Date;
    withinDays?: number;
    maxItems?: number;
  }
): JobWithDeadlineMeta<T>[] {
  const list = Array.isArray(jobs) ? jobs : [];
  const now = opts?.now ?? new Date();
  const within = opts?.withinDays ?? UPCOMING_JOB_DEADLINE_WITHIN_DAYS;
  const maxItems = opts?.maxItems ?? 12;

  const out: JobWithDeadlineMeta<T>[] = [];
  for (const job of list) {
    if (!isJobOpenForDeadlineWidget(job)) continue;
    const end = String(job.endDate ?? "").trim();
    if (!end) continue;
    const days = calendarDaysUntilJobDeadline(end, now);
    if (days === null) continue;
    if (days > within) continue;
    out.push({
      ...job,
      daysUntil: days,
      urgency: deadlineUrgency(days),
    });
  }

  out.sort((a, b) => {
    const da = calendarDaysUntilJobDeadline(String(a.endDate ?? ""), now);
    const db = calendarDaysUntilJobDeadline(String(b.endDate ?? ""), now);
    const na = da ?? 99999;
    const nb = db ?? 99999;
    return na - nb;
  });

  return out.slice(0, maxItems);
}

export function formatDaysUntilDeadlineLabel(daysUntil: number): string {
  if (daysUntil < 0) {
    const n = Math.abs(daysUntil);
    return n === 1 ? "1 den po termínu" : `${n} d. po termínu`;
  }
  if (daysUntil === 0) return "Dnes je termín";
  if (daysUntil === 1) return "Zbývá 1 den";
  return `Zbývá ${daysUntil} d.`;
}
