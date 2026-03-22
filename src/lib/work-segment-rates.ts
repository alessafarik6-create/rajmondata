/**
 * Hodinové sazby pro pracovní segmenty (zakázka vs interní tarif).
 */

import { parseHourlyRate } from "@/lib/attendance-shift-state";

export function resolveEmployeeDefaultHourlyRate(
  employee: Record<string, unknown> | undefined
): number | null {
  return parseHourlyRate(employee?.hourlyRate);
}

/** Alias — výchozí hodinová sazba zaměstnance (mimo zakázku / tarif). */
export const resolveEmployeeHourlyRate = resolveEmployeeDefaultHourlyRate;

/** Zakázka: vlastní laborHourlyRate / hourlyLaborRate, jinak výchozí sazba zaměstnance. */
export function resolveJobHourlyRate(
  job: Record<string, unknown> | undefined,
  employeeDefault: number | null
): number | null {
  const fromJob = parseHourlyRate(
    job?.hourlyLaborRate ?? job?.laborHourlyRate ?? job?.hourlyRate
  );
  if (fromJob != null) return fromJob;
  return employeeDefault;
}

export function resolveTariffHourlyRate(
  tariff: Record<string, unknown> | undefined
): number | null {
  return parseHourlyRate(tariff?.hourlyRateCzk ?? tariff?.hourlyRate);
}

export function computeSegmentAmount(hours: number, rateCzk: number | null): number {
  const r = rateCzk != null ? Number(rateCzk) : NaN;
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (!Number.isFinite(r) || r <= 0) return 0;
  return Math.round(h * r * 100) / 100;
}
