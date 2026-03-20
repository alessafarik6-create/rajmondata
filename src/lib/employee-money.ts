/**
 * Peníze zaměstnance: schválené hodiny, zálohy, formátování.
 */

import {
  endOfDay,
  endOfMonth,
  isWithinInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { cs } from "date-fns/locale";

export type WorkTimeReviewStatus =
  | "pending"
  | "approved"
  | "adjusted"
  | "rejected";

export type WorkTimeBlockMoney = {
  id?: string;
  date?: string;
  hours?: number;
  originalHours?: number;
  approvedHours?: number;
  reviewStatus?: WorkTimeReviewStatus | string;
  startTime?: string;
  endTime?: string;
  description?: string;
};

export type AdvanceStatus = "paid" | "unpaid";

export type AdvanceDoc = {
  id: string;
  amount: number;
  date: string;
  employeeId: string;
  companyId: string;
  note?: string;
  status: AdvanceStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
};

export function formatKc(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Zapsané hodiny (z výkazu). */
export function getLoggedHours(block: WorkTimeBlockMoney): number {
  const h = Number(block.hours);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/**
 * Hodiny započitatelné do výdělku: pouze schválené / upravené adminem.
 * Legacy dokumenty bez reviewStatus se berou jako schválené (zpětná kompatibilita).
 */
export function getPayableHours(block: WorkTimeBlockMoney): number {
  const logged = getLoggedHours(block);
  const ah =
    block.approvedHours != null && !Number.isNaN(Number(block.approvedHours))
      ? Number(block.approvedHours)
      : null;
  const st = block.reviewStatus;

  if (st === "pending") return 0;
  if (st === "rejected") return 0;
  if (st === "approved" || st === "adjusted") {
    const v = ah != null ? ah : logged;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  if (st == null || st === "") {
    return logged;
  }
  return 0;
}

export function getReviewLabel(status?: string): string {
  switch (status) {
    case "pending":
      return "Čeká na schválení";
    case "approved":
      return "Schváleno";
    case "adjusted":
      return "Upraveno administrátorem";
    case "rejected":
      return "Zamítnuto";
    default:
      return "Schváleno (dříve zapsáno)";
  }
}

/** yyyy-MM-dd v lokálním kalendáři (bez posunu UTC). */
function parseBlockDay(dateStr: string | undefined): Date | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function blockDateInLocalDay(
  block: WorkTimeBlockMoney,
  dayStart: Date,
  dayEnd: Date
): boolean {
  const d = parseBlockDay(block.date);
  if (!d) return false;
  return isWithinInterval(d, { start: dayStart, end: dayEnd });
}

export function sumPayableHoursForBlocks(
  blocks: WorkTimeBlockMoney[],
  range?: { start: Date; end: Date }
): number {
  let sum = 0;
  for (const b of blocks) {
    if (range) {
      const d = parseBlockDay(b.date);
      if (!d || !isWithinInterval(d, { start: range.start, end: range.end }))
        continue;
    }
    sum += getPayableHours(b);
  }
  return Math.round(sum * 100) / 100;
}

export function sumMoneyForBlocks(
  blocks: WorkTimeBlockMoney[],
  hourlyRate: number,
  range?: { start: Date; end: Date }
): number {
  const h = sumPayableHoursForBlocks(blocks, range);
  const r = Number(hourlyRate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.round(h * r * 100) / 100;
}

export function sumPaidAdvances(advances: AdvanceDoc[]): number {
  let s = 0;
  for (const a of advances) {
    if (a.status === "paid") {
      const n = Number(a.amount);
      if (Number.isFinite(n) && n > 0) s += n;
    }
  }
  return Math.round(s * 100) / 100;
}

export function todayRange(now = new Date()) {
  return { start: startOfDay(now), end: endOfDay(now) };
}

export function thisWeekRange(now = new Date()) {
  return {
    start: startOfWeek(now, { weekStartsOn: 1, locale: cs }),
    end: endOfDay(now),
  };
}

export function thisMonthRange(now = new Date()) {
  return { start: startOfMonth(now), end: endOfMonth(now) };
}
