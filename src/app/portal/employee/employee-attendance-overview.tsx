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
import { Badge } from "@/components/ui/badge";
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
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
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

/** Stačí jedno pole + limit — bez složeného indexu (employeeId + date). Datum filtrujeme v klientovi. */
const EMPLOYEE_FETCH_LIMIT = 3000;

function mergeDocsById<T extends { id?: string }>(batches: T[][]): T[] {
  const map = new Map<string, T>();
  for (const batch of batches) {
    for (const row of batch) {
      const id = String(row?.id ?? "");
      if (!id) continue;
      if (!map.has(id)) map.set(id, row);
    }
  }
  return Array.from(map.values());
}

function rowInDateRange(
  row: { date?: unknown; timestamp?: unknown; startAt?: unknown },
  startIso: string,
  endIso: string
): boolean {
  const localIso = (dt: Date): string => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const fromUnknown = (v: unknown): Date | null => {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (v && typeof (v as { toDate?: () => Date }).toDate === "function") {
      try {
        const d = (v as { toDate: () => Date }).toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
    return null;
  };
  const rawDate = row.date;
  const dateFromRaw = fromUnknown(rawDate);
  const dateFromTs = fromUnknown(row.timestamp);
  const dateFromStart = fromUnknown(row.startAt);
  const d =
    (typeof rawDate === "string" && rawDate.trim().slice(0, 10)) ||
    (rawDate instanceof Date ? localIso(rawDate) : "") ||
    (dateFromRaw ? localIso(dateFromRaw) : "") ||
    (dateFromTs ? localIso(dateFromTs) : "") ||
    (dateFromStart ? localIso(dateFromStart) : "");
  if (!d) return false;
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const [ry, rm, rd] = d.split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed || !ry || !rm || !rd) return false;
  const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
  const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
  const rec = new Date(ry, rm - 1, rd, 12, 0, 0, 0);
  return rec >= start && rec <= end;
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

  const needAltEmployeeKey =
    Boolean(authUserId) && Boolean(employeeId) && authUserId !== employeeId;

  const attendanceQueryPrimary = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", employeeId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const attendanceQueryAlt = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltEmployeeKey) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", authUserId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, needAltEmployeeKey, authUserId]);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const workBlocksQueryPrimary = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", employeeId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const workBlocksQueryAlt = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltEmployeeKey) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", authUserId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, needAltEmployeeKey, authUserId]);

  const workSegmentsQueryPrimary = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const workSegmentsQueryAlt = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltEmployeeKey) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", authUserId),
      limit(EMPLOYEE_FETCH_LIMIT)
    );
  }, [firestore, companyId, needAltEmployeeKey, authUserId]);

  const { data: rawAttendancePrimary = [], isLoading: attLoadP, error: attErrP } =
    useCollection(attendanceQueryPrimary, silentListen);
  const { data: rawAttendanceAlt = [], isLoading: attLoadA, error: attErrA } =
    useCollection(attendanceQueryAlt, silentListen);
  const { data: dailyReportsRaw = [], isLoading: drLoading, error: drError } =
    useCollection(dailyReportsQuery, silentListen);
  const { data: workBlocksPrimary = [], isLoading: wbLoadP, error: wbErrP } =
    useCollection(workBlocksQueryPrimary, silentListen);
  const { data: workBlocksAlt = [], isLoading: wbLoadA, error: wbErrA } =
    useCollection(workBlocksQueryAlt, silentListen);
  const { data: segmentsPrimary = [], isLoading: segLoadP, error: segErrP } =
    useCollection(workSegmentsQueryPrimary, silentListen);
  const { data: segmentsAlt = [], isLoading: segLoadA, error: segErrA } =
    useCollection(workSegmentsQueryAlt, silentListen);

  const attLoading = attLoadP || (needAltEmployeeKey ? attLoadA : false);
  const wbLoading = wbLoadP || (needAltEmployeeKey ? wbLoadA : false);
  const segLoading = segLoadP || (needAltEmployeeKey ? segLoadA : false);

  const attError = attErrP || attErrA;
  const wbError = wbErrP || wbErrA;
  const segError = segErrP || segErrA;
  const dataError = attError || drError || wbError || segError;

  const attendanceRows = useMemo(() => {
    const merged = mergeDocsById<AttendanceRow>([
      (Array.isArray(rawAttendancePrimary) ? rawAttendancePrimary : []) as AttendanceRow[],
      (Array.isArray(rawAttendanceAlt) ? rawAttendanceAlt : []) as AttendanceRow[],
    ]);
    return merged.filter((row) => rowInDateRange(row, rangeStr.start, rangeStr.end));
  }, [rawAttendancePrimary, rawAttendanceAlt, rangeStr.start, rangeStr.end]);

  const dailyReports = useMemo(() => {
    const raw = (Array.isArray(dailyReportsRaw) ? dailyReportsRaw : []) as Record<
      string,
      unknown
    >[];
    return raw.filter((row) => rowInDateRange(row, rangeStr.start, rangeStr.end));
  }, [dailyReportsRaw, rangeStr.start, rangeStr.end]);

  const workBlocks = useMemo(() => {
    const merged = mergeDocsById<WorkTimeBlockMoney>([
      (Array.isArray(workBlocksPrimary) ? workBlocksPrimary : []) as WorkTimeBlockMoney[],
      (Array.isArray(workBlocksAlt) ? workBlocksAlt : []) as WorkTimeBlockMoney[],
    ]);
    return merged.filter((row) => rowInDateRange(row, rangeStr.start, rangeStr.end));
  }, [workBlocksPrimary, workBlocksAlt, rangeStr.start, rangeStr.end]);

  const workSegments = useMemo(() => {
    const merged = mergeDocsById<WorkSegmentClient>([
      (Array.isArray(segmentsPrimary) ? segmentsPrimary : []) as WorkSegmentClient[],
      (Array.isArray(segmentsAlt) ? segmentsAlt : []) as WorkSegmentClient[],
    ]);
    return merged.filter((row) => rowInDateRange(row, rangeStr.start, rangeStr.end));
  }, [segmentsPrimary, segmentsAlt, rangeStr.start, rangeStr.end]);

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

  const hasEmptyExportData = detailTotals.daysWorked === 0;
  const hasWorkInRange = detailTotals.daysWorked > 0;

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
          <p className="font-semibold">Část dat se momentálně nepodařila načíst.</p>
          <p className="mt-1">
            {isFirestoreIndexError(dataError)
              ? "Databáze ještě připravuje index, nebo část dotazů není k dispozici. Zkuste to později — přehled níže používá jen úspěšně načtená data."
              : "Zkuste obnovit stránku. Pokud problém přetrvává, kontaktujte administrátora."}
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
            ) : attError && wbError && segError ? (
              <p className="text-sm text-neutral-900">
                Orientační částku nelze spočítat — nepodařilo se načíst docházku ani související údaje.
              </p>
            ) : hourlyRate > 0 ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-950 sm:text-3xl">
                  {formatKc(detailTotals.orientacniKc)}
                </p>
                <p className="text-xs text-neutral-900">
                  Dle rozpisu docházky a tarifů v období (viz níže).
                  {(attError || wbError || segError) && !loading ? (
                    <span className="mt-1 block font-medium text-amber-900">
                      Pozn.: část podkladů se nenačetla — částka může být neúplná.
                    </span>
                  ) : null}
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
            ) : drError ? (
              <p className="text-sm text-neutral-900">
                Schválenou částku nelze zobrazit — nepodařilo se načíst denní výkazy.
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
                  <p className="text-xs font-medium text-neutral-800">Docházka celkem</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {detailTotals.hours > 0 ? `${detailTotals.hours} h` : "0 h"}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Z toho tarifní čas</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.totalTariffHours)}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Z toho hodinová práce</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.totalHoursOutsideTariffOnly)}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Schválený výdělek</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatKc(detailTotals.approvedKc)}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Neschválený výdělek</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatKc(detailTotals.pendingKc)}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Celkový výdělek</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-neutral-950">
                    {formatKc(detailTotals.orientacniKc)}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Schválené hodinové hodiny</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.approvedHourlyHours)}
                  </p>
                </div>
                <div className="rounded-lg border border-neutral-950 bg-white p-3">
                  <p className="text-xs font-medium text-neutral-800">Neschválené hodinové hodiny</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-neutral-950">
                    {formatHoursMinutes(detailTotals.pendingHourlyHours)}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
                <div className="rounded-lg border border-emerald-700 bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-900">Zaplacené dny</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-emerald-900">
                    {detailTotals.paidDays}
                  </p>
                  <p className="text-xs text-emerald-800">{formatKc(detailTotals.paidAmountKc)}</p>
                </div>
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-3">
                  <p className="text-xs font-medium text-rose-900">Nezaplacené dny</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-rose-900">
                    {detailTotals.unpaidDays}
                  </p>
                  <p className="text-xs text-rose-800">{formatKc(detailTotals.unpaidAmountKc)}</p>
                </div>
              </div>
              {detailTotals.invalidAttendanceDays > 0 ? (
                <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  {detailTotals.invalidAttendanceDays} dnů má neúplnou docházku (chybí příchod/odchod)
                  a nebylo započteno do výpočtu hodin ani výdělku.
                </p>
              ) : null}

              <div className="hidden space-y-4 md:block print:block print:space-y-4">
                {!hasWorkInRange ? (
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
                          <p className="text-xs font-medium text-neutral-800">Celková směna</p>
                          <p className="font-semibold tabular-nums text-neutral-950">
                            {day.totalSpanH != null ? `${day.totalSpanH} h` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-neutral-800">Pauza</p>
                          <p className="font-semibold tabular-nums text-neutral-950">
                            {formatHoursMinutes(day.pauseH)}
                          </p>
                        </div>
                      </div>
                      {day.hasIncompleteAttendance ? (
                        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          Neúplná docházka (chybí příchod nebo odchod) — den není započten do výpočtu.
                        </p>
                      ) : null}
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
                        <span>
                          Neschváleno:{" "}
                          <strong className="text-neutral-950">
                            {day.neschvalenoKc > 0 ? formatKc(day.neschvalenoKc) : "—"}
                          </strong>
                        </span>
                        <span>
                          {day.paidStatus === "paid" ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Zaplaceno</Badge>
                          ) : day.paidStatus === "unpaid" ? (
                            <Badge variant="destructive">Nezaplaceno</Badge>
                          ) : (
                            <Badge variant="secondary">Bez platby</Badge>
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 md:hidden print:hidden">
                {!hasWorkInRange ? (
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
                            <span className="text-neutral-700">Celková směna / pauza</span>
                            <p className="font-medium">
                              {day.totalSpanH != null ? `${day.totalSpanH} h` : "—"} /{" "}
                              {formatHoursMinutes(day.pauseH)}
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
