"use client";

import React, { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { cs } from "date-fns/locale";
import { collection, query, where, limit } from "firebase/firestore";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
} from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Calendar,
  Clock,
  Loader2,
  CircleDollarSign,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKc } from "@/lib/employee-money";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { WorkTimeBlockMoney } from "@/lib/employee-money";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  buildEmployeeDailyDetailRows,
  computePeriodRange,
  formatHoursMinutes,
  totalsFromDailyDetailRows,
  type EmployeeLite,
  type PeriodMode,
} from "@/lib/attendance-overview-compute";
import { AttendanceExportDocument } from "../labor/dochazka/prehled/attendance-export-document";

function firestoreSafeLimit(limitValue: unknown): number {
  return Math.min(Math.max(Number(limitValue) || 50, 1), 1000);
}

const silentListen = { suppressGlobalPermissionError: true as const };

const panel =
  "border-2 border-neutral-950 bg-white text-neutral-950 shadow-sm rounded-xl";

type Props = {
  companyId: string;
  /** Pouze z profilu přihlášeného uživatele — žádné parametry z URL. */
  employeeId: string;
  authUserId: string;
  employeeDisplayName: string;
  companyName: string | null | undefined;
  hourlyRate: number;
};

export function EmployeeAttendanceOverview({
  companyId,
  employeeId,
  authUserId,
  employeeDisplayName,
  companyName,
  hourlyRate,
}: Props) {
  const firestore = useFirestore();

  const [periodMode, setPeriodMode] = useState<PeriodMode>("week");
  const [anchorDate, setAnchorDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [customFrom, setCustomFrom] = useState(() =>
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const anchor = useMemo(() => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  }, [anchorDate]);

  const range = useMemo(() => {
    if (periodMode === "custom") {
      const [fy, fm, fd] = customFrom.split("-").map(Number);
      const [ty, tm, td] = customTo.split("-").map(Number);
      const from = new Date(fy, fm - 1, fd);
      const to = new Date(ty, tm - 1, td);
      return computePeriodRange("custom", anchor, { from, to });
    }
    return computePeriodRange(periodMode, anchor);
  }, [periodMode, anchor, customFrom, customTo]);

  const rangeStr = useMemo(
    () => ({
      start: format(range.start, "yyyy-MM-dd"),
      end: format(range.end, "yyyy-MM-dd"),
    }),
    [range]
  );

  const employeeLite: EmployeeLite = useMemo(
    () => ({
      id: employeeId,
      displayName: employeeDisplayName,
      hourlyRate: Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0,
      authUserId,
    }),
    [employeeId, employeeDisplayName, hourlyRate, authUserId]
  );

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const ids = [...new Set([employeeId, authUserId].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    const lim = firestoreSafeLimit(1000);
    if (ids.length === 1) {
      return query(
        base,
        where("employeeId", "==", ids[0]),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(lim)
      );
    }
    return query(
      base,
      where("employeeId", "in", ids),
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(lim)
    );
  }, [firestore, companyId, employeeId, authUserId, rangeStr.start, rangeStr.end]);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(firestoreSafeLimit(1000))
    );
  }, [firestore, companyId, employeeId, rangeStr.start, rangeStr.end]);

  const workBlocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const ids = [...new Set([employeeId, authUserId].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "work_time_blocks");
    const lim = firestoreSafeLimit(1000);
    if (ids.length === 1) {
      return query(
        base,
        where("employeeId", "==", ids[0]),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(lim)
      );
    }
    return query(
      base,
      where("employeeId", "in", ids),
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(lim)
    );
  }, [firestore, companyId, employeeId, authUserId, rangeStr.start, rangeStr.end]);

  const workSegmentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const ids = [...new Set([employeeId, authUserId].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "work_segments");
    const lim = firestoreSafeLimit(1000);
    if (ids.length === 1) {
      return query(
        base,
        where("employeeId", "==", ids[0]),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(lim)
      );
    }
    return query(
      base,
      where("employeeId", "in", ids),
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(lim)
    );
  }, [firestore, companyId, employeeId, authUserId, rangeStr.start, rangeStr.end]);

  const { data: rawAttendance = [], isLoading: attLoading, error: attError } =
    useCollection(attendanceQuery, silentListen);
  const { data: dailyReportsRaw = [], isLoading: drLoading, error: drError } =
    useCollection(dailyReportsQuery, silentListen);
  const { data: workBlocksRaw = [], isLoading: wbLoading, error: wbError } =
    useCollection(workBlocksQuery, silentListen);
  const { data: segmentsRaw = [], isLoading: segLoading, error: segError } =
    useCollection(workSegmentsQuery, silentListen);

  const dataError = attError || drError || wbError || segError;

  const attendanceRows = useMemo(
    () => (Array.isArray(rawAttendance) ? rawAttendance : []) as AttendanceRow[],
    [rawAttendance]
  );
  const dailyReports = useMemo(
    () => (Array.isArray(dailyReportsRaw) ? dailyReportsRaw : []) as Record<string, unknown>[],
    [dailyReportsRaw]
  );
  const workBlocks = useMemo(
    () => (Array.isArray(workBlocksRaw) ? workBlocksRaw : []) as WorkTimeBlockMoney[],
    [workBlocksRaw]
  );
  const workSegments = useMemo(
    () => (Array.isArray(segmentsRaw) ? segmentsRaw : []) as WorkSegmentClient[],
    [segmentsRaw]
  );

  const dailyDetailRows = useMemo(
    () =>
      buildEmployeeDailyDetailRows({
        range,
        employee: employeeLite,
        attendanceRaw: attendanceRows,
        dailyReports,
        workBlocks,
        segments: workSegments,
      }),
    [range, employeeLite, attendanceRows, dailyReports, workBlocks, workSegments]
  );

  const detailTotals = useMemo(
    () => totalsFromDailyDetailRows(dailyDetailRows),
    [dailyDetailRows]
  );

  const loading = attLoading || drLoading || wbLoading || segLoading;

  const periodTitle =
    periodMode === "day"
      ? "Den"
      : periodMode === "week"
        ? "Týden"
        : periodMode === "month"
          ? "Měsíc"
          : "Vlastní období";

  const customRangeLine =
    periodMode === "custom" ? `${customFrom} – ${customTo}` : null;

  const employeeLabel = employeeDisplayName;

  const shiftAnchor = (deltaDays: number) => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    setAnchorDate(format(dt, "yyyy-MM-dd"));
  };

  const handlePrint = () => window.print();

  const hasEmptyExportData = dailyDetailRows.length === 0;

  const hasApprovedReport = useMemo(
    () =>
      dailyReports.some((row) => String(row.status) === "approved"),
    [dailyReports]
  );

  const formatRateKcPerH = (kc: number | null) => {
    if (kc == null || !Number.isFinite(kc)) return "—";
    return `${Math.round(kc)} Kč/h`;
  };

  return (
    <>
      {dataError ? (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 print:hidden">
          <p className="font-semibold">Část dat se nepodařila načíst</p>
          <p className="mt-1">
            {dataError.message ||
              "Zkontrolujte oprávnění nebo zkuste stránku znovu načíst. Přehled se zobrazí z dostupných údajů."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={cn(panel)}>
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <CircleDollarSign className="h-4 w-4 shrink-0" aria-hidden />
              Orientační výdělek ({range.label})
            </CardTitle>
            <p className="text-xs leading-relaxed text-neutral-900">
              Odhad za zvolené období — <strong className="text-neutral-950">ne závazná výplata</strong>.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-neutral-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám…
              </p>
            ) : hourlyRate > 0 ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-950 sm:text-3xl">
                  {formatKc(detailTotals.orientacniKc)}
                </p>
                <p className="text-xs text-neutral-900">
                  Dle rozpisu docházky a tarifů v období (viz níže).
                </p>
              </div>
            ) : (
              <p className="text-sm text-neutral-900">
                Hodinová sazba není nastavena — orientační částku nelze spočítat.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className={cn(panel)}>
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
              Schválený výdělek ({range.label})
            </CardTitle>
            <p className="text-xs leading-relaxed text-neutral-900">
              Součet schválených částek z výkazů a bloků v období.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-neutral-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám…
              </p>
            ) : hasApprovedReport || detailTotals.approvedKc > 0 ? (
              <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-950 sm:text-3xl">
                {formatKc(detailTotals.approvedKc)}
              </p>
            ) : (
              <p className="text-sm font-medium text-neutral-950">V období nic schváleno</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn(panel)}>
        <CardHeader className="space-y-3 pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
                <Clock className="h-4 w-4" aria-hidden />
                Moje docházka
              </CardTitle>
              <p className="mt-1 text-xs text-neutral-900">
                Pouze váš přehled — data nelze z této stránky upravovat.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[44px] shrink-0 border-neutral-950 bg-white text-neutral-950 print:hidden"
              onClick={handlePrint}
              disabled={loading}
            >
              <Printer className="mr-2 h-4 w-4" />
              Tisk
            </Button>
          </div>

          <div className="grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50/80 p-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
            <div>
              <Label className="text-xs font-medium text-neutral-800">Období</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["day", "week", "month", "custom"] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={periodMode === m ? "default" : "outline"}
                    className={
                      periodMode === m
                        ? "bg-neutral-950 text-white hover:bg-neutral-900"
                        : "border-neutral-950 bg-white text-neutral-950"
                    }
                    onClick={() => setPeriodMode(m)}
                  >
                    {m === "day"
                      ? "Den"
                      : m === "week"
                        ? "Týden"
                        : m === "month"
                          ? "Měsíc"
                          : "Vlastní"}
                  </Button>
                ))}
              </div>
            </div>
            {periodMode === "custom" ? (
              <div className="sm:col-span-2 lg:col-span-2">
                <Label className="text-xs font-medium text-neutral-800">Datum od – do</Label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="max-w-[160px] border-neutral-950 bg-white"
                  />
                  <span className="text-neutral-600">–</span>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="max-w-[160px] border-neutral-950 bg-white"
                  />
                </div>
              </div>
            ) : (
              <div className="sm:col-span-2 lg:col-span-2">
                <Label className="text-xs font-medium text-neutral-800">Návěstí období</Label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 border-neutral-950"
                    onClick={() => shiftAnchor(-1)}
                    aria-label="Předchozí období"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={anchorDate}
                    onChange={(e) => setAnchorDate(e.target.value)}
                    className="max-w-[200px] border-neutral-950 bg-white"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 border-neutral-950"
                    onClick={() => shiftAnchor(1)}
                    aria-label="Další období"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-end">
              <p className="flex items-center gap-2 text-sm font-medium text-neutral-950">
                <Calendar className="h-4 w-4 shrink-0" />
                {range.label}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 text-sm text-neutral-900">
          {loading ? (
            <p className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám docházku…
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Dny s prací</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {detailTotals.daysWorked}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Odpracováno celkem</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {detailTotals.hours > 0 ? `${detailTotals.hours} h` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Čas na tarifech</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.totalTariffHours)}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Čas mimo tarif</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.totalHoursOutsideTariffOnly)}
                  </p>
                </div>
              </div>

              <div className="hidden space-y-4 md:block print:block print:space-y-4">
                {dailyDetailRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-neutral-400 p-6 text-center text-neutral-800">
                    V tomto období nejsou žádné záznamy docházky.
                  </p>
                ) : (
                  dailyDetailRows.map((day) => (
                    <div
                      key={day.key}
                      className="break-inside-avoid rounded-lg border-2 border-neutral-950 bg-white p-4 print:break-inside-avoid"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 pb-2">
                        <h3 className="text-base font-semibold capitalize text-neutral-950">
                          {day.dayTitle}
                        </h3>
                        <span className="text-xs font-medium text-neutral-800">
                          Záznamů: {day.bloku}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Příchod</p>
                          <p className="text-lg font-semibold tabular-nums text-neutral-950">
                            {day.prichod}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Odchod</p>
                          <p className="text-lg font-semibold tabular-nums text-neutral-950">
                            {day.odchod}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Odpracováno</p>
                          <p className="text-lg font-semibold tabular-nums text-neutral-950">
                            {day.odpracovanoH != null ? `${day.odpracovanoH} h` : "—"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Čas na tarifech</p>
                          <p className="font-semibold tabular-nums text-neutral-950">
                            {formatHoursMinutes(day.tariffHoursTotal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Čas mimo tarif</p>
                          <p className="font-semibold tabular-nums text-neutral-950">
                            {formatHoursMinutes(day.hoursOutsideTariffOnly)}
                          </p>
                        </div>
                      </div>

                      {day.tariffSegments.length > 0 && (
                        <div className="mt-4 border-t border-neutral-200 pt-3">
                          <p className="text-xs font-bold uppercase tracking-wide text-neutral-950">
                            Tarifní úseky
                          </p>
                          <ul className="mt-2 space-y-2">
                            {day.tariffSegments.map((t) => (
                              <li
                                key={t.id}
                                className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-neutral-950"
                              >
                                <span className="font-medium">{t.label}</span>
                                <span className="ml-2 tabular-nums text-neutral-900">
                                  {t.startHm}–{t.endLabel} · {formatHoursMinutes(t.durationH)} ·{" "}
                                  {formatRateKcPerH(t.rateKcPerH)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-4 border-t border-neutral-100 pt-3 text-xs text-neutral-800">
                        <span>
                          Orientačně: <strong className="text-neutral-950">{formatKc(day.orientacniKc)}</strong>
                        </span>
                        <span>
                          Schváleno:{" "}
                          <strong className="text-neutral-950">
                            {day.schvalenoKc > 0
                              ? formatKc(day.schvalenoKc)
                              : day.schvalenoStatus === "pending"
                                ? "čeká"
                                : (day.odpracovanoH ?? 0) > 0
                                  ? "—"
                                  : "—"}
                          </strong>
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 md:hidden print:hidden">
                {dailyDetailRows.length === 0 ? (
                  <p className="text-center text-neutral-800">Žádná data v období.</p>
                ) : (
                  dailyDetailRows.map((day) => (
                    <Collapsible
                      key={day.key}
                      defaultOpen={false}
                      className="group rounded-lg border-2 border-neutral-950 bg-white"
                    >
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold text-neutral-950">
                        <span className="capitalize">{day.dayTitle}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border-t border-neutral-200 px-4 pb-4 text-neutral-900">
                        <div className="grid grid-cols-2 gap-2 pt-3 text-sm">
                          <div>
                            <span className="text-neutral-700">Příchod</span>
                            <p className="font-medium">{day.prichod}</p>
                          </div>
                          <div>
                            <span className="text-neutral-700">Odchod</span>
                            <p className="font-medium">{day.odchod}</p>
                          </div>
                          <div>
                            <span className="text-neutral-700">Odpracováno</span>
                            <p className="font-medium">
                              {day.odpracovanoH != null ? `${day.odpracovanoH} h` : "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-neutral-700">Tarify / mimo</span>
                            <p className="font-medium">
                              {formatHoursMinutes(day.tariffHoursTotal)} /{" "}
                              {formatHoursMinutes(day.hoursOutsideTariffOnly)}
                            </p>
                          </div>
                        </div>
                        {day.tariffSegments.map((t) => (
                          <div key={t.id} className="mt-2 rounded border border-neutral-200 px-2 py-1.5 text-xs">
                            <span className="font-medium text-neutral-950">{t.label}</span>
                            <div className="tabular-nums text-neutral-800">
                              {t.startHm}–{t.endLabel} · {formatHoursMinutes(t.durationH)} ·{" "}
                              {formatRateKcPerH(t.rateKcPerH)}
                            </div>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {!loading && (
        <AttendanceExportDocument
          className="attendance-print-root hidden print:block"
          companyName={companyName || ""}
          companyId={companyId}
          rangeLabel={range.label}
          periodTitle={periodTitle}
          customRangeLine={customRangeLine}
          employeeLabel={employeeLabel}
          generatedAtLabel={format(new Date(), "d. M. yyyy HH:mm", { locale: cs })}
          variant="detail"
          dailyDetailRows={dailyDetailRows}
          detailTotals={detailTotals}
          summaryTotalsAll={null}
          tableRows={[]}
          aggregateTotals={{ hours: 0, approvedKc: 0, pendingKc: 0 }}
          hasEmptyData={hasEmptyExportData}
        />
      )}
    </>
  );
}
