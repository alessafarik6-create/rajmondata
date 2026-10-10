import {
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subMonths,
} from "date-fns";
import { cs } from "date-fns/locale";
import {
  computePeriodRange,
  type PeriodRange,
} from "@/lib/attendance-overview-compute";

export type MoneyPeriodPreset = "this_month" | "last_month" | "this_year" | "custom";

export function resolveEmployeeMoneyPeriod(
  preset: MoneyPeriodPreset,
  now: Date = new Date(),
  custom?: { from: Date; to: Date } | null
): PeriodRange {
  if (preset === "this_month") {
    return computePeriodRange("month", now);
  }
  if (preset === "last_month") {
    const anchor = subMonths(now, 1);
    return computePeriodRange("month", anchor);
  }
  if (preset === "this_year") {
    const from = startOfYear(now);
    const to = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );
    return computePeriodRange("custom", now, { from, to });
  }
  if (preset === "custom" && custom) {
    return computePeriodRange("custom", now, custom);
  }
  return computePeriodRange("month", now);
}

export function periodIsoBounds(range: PeriodRange): { startIso: string; endIso: string } {
  return {
    startIso: format(range.start, "yyyy-MM-dd"),
    endIso: format(range.end, "yyyy-MM-dd"),
  };
}

export function formatMoneyPeriodCaption(range: PeriodRange): string {
  const sameMonth =
    range.start.getFullYear() === range.end.getFullYear() &&
    range.start.getMonth() === range.end.getMonth();
  if (sameMonth && range.start.getDate() === 1) {
    const lastDay = endOfMonth(range.start).getDate();
    if (range.end.getDate() === lastDay) {
      return format(range.start, "LLLL yyyy", { locale: cs });
    }
  }
  return `${format(range.start, "d. M. yyyy", { locale: cs })} – ${format(
    range.end,
    "d. M. yyyy",
    { locale: cs }
  )}`;
}

export const MONEY_PERIOD_PRESET_LABEL: Record<MoneyPeriodPreset, string> = {
  this_month: "Tento měsíc",
  last_month: "Minulý měsíc",
  this_year: "Tento rok",
  custom: "Vlastní období",
};
