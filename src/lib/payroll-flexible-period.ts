/**
 * Období pro výplaty / přehledy — týden, měsíc, vlastní rozsah.
 */

import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { cs } from "date-fns/locale";
import { payrollPeriodBounds } from "@/lib/payroll-period";

export type PayrollPeriodPreset =
  | "calendar_month"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom";

export type FlexiblePayrollBounds = {
  startStr: string;
  endStr: string;
  label: string;
  /** Klíč yyyy-MM pro měsíční uzávěrky (měsíc konce období). */
  payrollPeriod: string;
};

function boundsFromStartEnd(start: Date, end: Date): FlexiblePayrollBounds {
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
  const label = sameMonth
    ? `${format(start, "d.", { locale: cs })} – ${format(end, "d. M. yyyy", { locale: cs })}`
    : `${format(start, "d. M. yyyy", { locale: cs })} – ${format(end, "d. M. yyyy", { locale: cs })}`;
  const payrollPeriod = format(end, "yyyy-MM");
  return { startStr, endStr, label, payrollPeriod };
}

function parseYmd(s: string): Date | null {
  const t = String(s ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function computeFlexiblePayrollBounds(
  preset: PayrollPeriodPreset,
  opts: {
    now?: Date;
    calendarYear?: number;
    calendarMonth?: number;
    customFromStr?: string;
    customToStr?: string;
  }
): FlexiblePayrollBounds {
  const now = opts.now ?? new Date();

  if (preset === "calendar_month") {
    const y = opts.calendarYear ?? now.getFullYear();
    const m = opts.calendarMonth ?? now.getMonth() + 1;
    const b = payrollPeriodBounds(y, m);
    return {
      startStr: b.startStr,
      endStr: b.endStr,
      label: b.label,
      payrollPeriod: b.payrollPeriod,
    };
  }

  if (preset === "this_week") {
    const start = startOfWeek(now, { weekStartsOn: 1, locale: cs });
    const end = endOfWeek(now, { weekStartsOn: 1, locale: cs });
    return boundsFromStartEnd(start, end);
  }

  if (preset === "last_week") {
    const ref = subWeeks(now, 1);
    const start = startOfWeek(ref, { weekStartsOn: 1, locale: cs });
    const end = endOfWeek(ref, { weekStartsOn: 1, locale: cs });
    return boundsFromStartEnd(start, end);
  }

  if (preset === "this_month") {
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    return boundsFromStartEnd(start, end);
  }

  if (preset === "last_month") {
    const ref = subMonths(now, 1);
    const start = startOfMonth(ref);
    const end = endOfMonth(ref);
    return boundsFromStartEnd(start, end);
  }

  let a = parseYmd(opts.customFromStr ?? "") ?? now;
  let b = parseYmd(opts.customToStr ?? "") ?? now;
  if (a > b) {
    const t = a;
    a = b;
    b = t;
  }
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate(), 23, 59, 59, 999);
  return boundsFromStartEnd(start, end);
}
