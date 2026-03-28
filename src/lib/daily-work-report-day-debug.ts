/**
 * Diagnostika výpočtu času pro jeden den výkazu — zdroje a mezivýsledky.
 * V produkci se nic nevypisuje; v development `console.debug`.
 */

export type DailyWorkReportDayDebug = {
  dayIso: string;
  /** Seskupení docházky: lokální den z timestampu (ne pole date z API). */
  attendanceGrouping: "timestamp_local";
  attendance: {
    checkInHm: string | null;
    checkOutHm: string | null;
    totalSpanHours: number | null;
    breakHours: number;
    hoursWorkedNet: number | null;
    statusLabel: string;
  } | null;
  terminal: {
    closedSegmentCount: number;
    sumClosedHours: number;
    tariffHours: number;
    jobLockedHours: number;
    unlockedHours: number;
  };
  caps: {
    dayWorkedCapHours: number;
    lockedSumHours: number;
    availableForManualRowsHours: number;
    formHoursCapHours: number;
  };
  formState: {
    rowCount: number;
    sumUnlockedLineHours: number;
    totalAllocatedWithLockedHours: number;
    zbýváDoStropuSměnyHours: number;
    zbýváVŘádcíchHours: number;
  };
};

export function logDailyWorkReportDayDebug(info: DailyWorkReportDayDebug): void {
  if (process.env.NODE_ENV !== "development") return;
  console.debug("[daily-work-report-day]", info);
}
