/** Výchozí = zapnuto (zpětná kompatibilita). */
export function isDailyWorkLogEnabled(
  emp: { enableDailyWorkLog?: boolean } | null | undefined
): boolean {
  return emp?.enableDailyWorkLog !== false;
}

export function isWorkLogEnabled(
  emp: { enableWorkLog?: boolean } | null | undefined
): boolean {
  return emp?.enableWorkLog !== false;
}
