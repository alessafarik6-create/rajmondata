import { endOfMonth, format } from "date-fns";
import { cs } from "date-fns/locale";

export function payrollPeriodBounds(year: number, month: number) {
  const y = Math.min(2100, Math.max(1970, year));
  const m = Math.min(12, Math.max(1, month));
  const start = new Date(y, m - 1, 1);
  const end = endOfMonth(start);
  return {
    startStr: format(start, "yyyy-MM-dd"),
    endStr: format(end, "yyyy-MM-dd"),
    payrollPeriod: format(start, "yyyy-MM"),
    label: format(start, "LLLL yyyy", { locale: cs }),
  };
}

/** Je řetězec data YYYY-MM-DD v uzavřeném intervalu? */
export function dateStrInInclusiveRange(
  dateStr: string | undefined,
  startStr: string,
  endStr: string
): boolean {
  const d = String(dateStr ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= startStr && d <= endStr;
}
