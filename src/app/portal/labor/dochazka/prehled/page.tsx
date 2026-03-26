"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import {
  collection,
  doc,
  query,
  where,
  limit,
} from "firebase/firestore";
import { format, subDays } from "date-fns";
import { jsPDF } from "jspdf";
import {
  Loader2,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Printer,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { WorkTimeBlockMoney } from "@/lib/employee-money";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  attendanceRowMatchesEmployee,
  buildEmployeeDailyDetailRows,
  buildEmployeeMap,
  buildOverviewRows,
  computePeriodRange,
  firestoreEmployeeIdMatches,
  formatHoursMinutes,
  formatKc,
  totalsFromDailyDetailRows,
  totalsFromRows,
  type PeriodMode,
} from "@/lib/attendance-overview-compute";

const ALL = "__all__";

/**
 * Firestore: limit musí být celé číslo 1–1000; větší / NaN / null způsobí invalid-argument.
 */
function firestoreSafeLimit(limitValue: unknown): number {
  return Math.min(Math.max(Number(limitValue) || 50, 1), 1000);
}

function formatHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  return `${h} h`;
}

function formatRateKcPerH(kc: number | null): string {
  if (kc == null || !Number.isFinite(kc)) return "—";
  return `${Math.round(kc)} Kč/h`;
}

/** Součty hodin v období — 0 zobrazíme jako „0 h“, ne jako pomlčku. */
function formatHoursPeriodTotal(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "0 h";
  return formatHoursMinutes(h);
}

export default function AttendanceOverviewPage() {
  const router = useRouter();
  const { user } = useUser();
  const firestore = useFirestore();
  const { companyName } = useCompany();
  const { toast } = useToast();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;
  const role = (profile?.role as string | undefined) ?? "employee";

  const isPrivileged =
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "accountant";

  useEffect(() => {
    if (!profileLoading && profile && !isPrivileged) {
      router.replace("/portal/labor/dochazka");
    }
  }, [profileLoading, profile, isPrivileged, router]);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("week");
  const [anchorDate, setAnchorDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [customFrom, setCustomFrom] = useState(() =>
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [employeeFilter, setEmployeeFilter] = useState<string>(ALL);

  /** Firestore permission denied nesmí emitovat globální chybu — FirebaseErrorListener by shodil celou aplikaci. */
  const silentListen = useMemo(
    () => ({ suppressGlobalPermissionError: true as const }),
    []
  );

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

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const {
    data: employeesRaw = [],
    isLoading: employeesLoading,
    error: employeesError,
  } = useCollection(employeesQuery, silentListen);

  const employees = useMemo(
    () => buildEmployeeMap(Array.isArray(employeesRaw) ? employeesRaw : []),
    [employeesRaw]
  );

  /** Vždy jen podle data — filtr zaměstnance je v klientu (employeeId může být UID nebo id dokumentu). */
  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(firestoreSafeLimit(1000))
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end]);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "daily_work_reports");
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(firestoreSafeLimit(1000))
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end]);

  const workBlocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "work_time_blocks");
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(firestoreSafeLimit(1000))
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end]);

  const workSegmentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "work_segments");
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(firestoreSafeLimit(1000))
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end]);

  const {
    data: attendanceData = [],
    isLoading: attLoading,
    error: attendanceError,
  } = useCollection(attendanceQuery, silentListen);
  const {
    data: dailyReportsData = [],
    isLoading: drLoading,
    error: dailyReportsError,
  } = useCollection(dailyReportsQuery, silentListen);
  const {
    data: workBlocksData = [],
    isLoading: wbLoading,
    error: workBlocksError,
  } = useCollection(workBlocksQuery, silentListen);
  const {
    data: workSegmentsData = [],
    isLoading: segLoading,
    error: workSegmentsError,
  } = useCollection(workSegmentsQuery, silentListen);

  const attendanceRows = useMemo(
    () => (Array.isArray(attendanceData) ? attendanceData : []) as AttendanceRow[],
    [attendanceData]
  );

  const dailyReports = useMemo(
    () =>
      (Array.isArray(dailyReportsData) ? dailyReportsData : []) as Record<
        string,
        unknown
      >[],
    [dailyReportsData]
  );

  const workBlocks = useMemo(
    () =>
      (Array.isArray(workBlocksData) ? workBlocksData : []) as WorkTimeBlockMoney[],
    [workBlocksData]
  );

  const workSegments = useMemo(
    () => (Array.isArray(workSegmentsData) ? workSegmentsData : []) as WorkSegmentClient[],
    [workSegmentsData]
  );

  const filteredAttendance = useMemo(() => {
    if (employeeFilter === ALL) return attendanceRows;
    const emp = employees.get(employeeFilter);
    if (!emp) return [];
    return attendanceRows.filter((r) =>
      attendanceRowMatchesEmployee(r, emp.id, emp.authUserId)
    );
  }, [attendanceRows, employeeFilter, employees]);

  const filteredDailyReports = useMemo(() => {
    if (employeeFilter === ALL) return dailyReports;
    const emp = employees.get(employeeFilter);
    if (!emp) return [];
    return dailyReports.filter((r) =>
      firestoreEmployeeIdMatches(r?.employeeId, emp)
    );
  }, [dailyReports, employeeFilter, employees]);

  const filteredWorkBlocks = useMemo(() => {
    if (employeeFilter === ALL) return workBlocks;
    const emp = employees.get(employeeFilter);
    if (!emp) return [];
    return workBlocks.filter((b) => firestoreEmployeeIdMatches(b.employeeId, emp));
  }, [workBlocks, employeeFilter, employees]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const emp = employeeFilter !== ALL ? employees.get(employeeFilter) : null;
    console.log("[AttendanceOverview] debug", {
      selectedEmployeeId: employeeFilter,
      employeeDocId: emp?.id,
      authUserId: emp?.authUserId ?? null,
      rawAttendanceCount: attendanceRows.length,
      filteredAttendanceCount: filteredAttendance.length,
      sampleEmployeeIds: attendanceRows.slice(0, 12).map((r) => r.employeeId),
    });
  }, [
    employeeFilter,
    employees,
    attendanceRows,
    filteredAttendance,
  ]);

  const tableRows = useMemo(
    () =>
      buildOverviewRows({
        mode: periodMode,
        range,
        employeeFilterId: employeeFilter === ALL ? "__all__" : employeeFilter,
        attendanceRaw: filteredAttendance,
        employees,
        dailyReports: filteredDailyReports,
        workBlocks: filteredWorkBlocks,
      }),
    [
      periodMode,
      range,
      employeeFilter,
      filteredAttendance,
      employees,
      filteredDailyReports,
      filteredWorkBlocks,
    ]
  );

  const selectedEmployee =
    employeeFilter !== ALL ? employees.get(employeeFilter) : null;

  const dailyDetailRows = useMemo(() => {
    if (!selectedEmployee) return null;
    return buildEmployeeDailyDetailRows({
      range,
      employee: selectedEmployee,
      attendanceRaw: filteredAttendance,
      dailyReports: filteredDailyReports,
      workBlocks: filteredWorkBlocks,
      segments: workSegments,
    });
  }, [
    selectedEmployee,
    range,
    filteredAttendance,
    filteredDailyReports,
    filteredWorkBlocks,
    workSegments,
  ]);

  const aggregateTotals = useMemo(() => totalsFromRows(tableRows), [tableRows]);
  const detailTotals = useMemo(
    () => (dailyDetailRows ? totalsFromDailyDetailRows(dailyDetailRows) : null),
    [dailyDetailRows]
  );

  const showEmployeeDetail = Boolean(selectedEmployee && dailyDetailRows);

  const loading =
    profileLoading ||
    !companyId ||
    employeesLoading ||
    attLoading ||
    drLoading ||
    wbLoading ||
    segLoading;

  const employeeLabel =
    employeeFilter === ALL
      ? "Všichni zaměstnanci"
      : employees.get(employeeFilter)?.displayName ?? employeeFilter;

  const periodTitle =
    periodMode === "day"
      ? "Denní přehled"
      : periodMode === "week"
        ? "Týdenní přehled"
        : periodMode === "month"
          ? "Měsíční přehled"
          : "Vlastní období";

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handlePdf = useCallback(() => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 14;
    let y = 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Přehled docházky a výdělků", margin, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Organizace: ${companyName || companyId || "—"}`, margin, y);
    y += 5;
    doc.text(`Období: ${range.label}`, margin, y);
    y += 5;
    doc.text(`Režim: ${periodTitle}`, margin, y);
    y += 5;
    doc.text(`Zaměstnanec: ${employeeLabel}`, margin, y);
    y += 8;

    if (showEmployeeDetail && dailyDetailRows && detailTotals) {
      doc.setFont("helvetica", "bold");
      doc.text(
        `Dny s prací: ${detailTotals.daysWorked} | Hodiny docházky: ${formatHours(detailTotals.hours)} | Schváleno: ${formatKc(detailTotals.approvedKc)} | Orientačně: ${formatKc(detailTotals.orientacniKc)}`,
        margin,
        y
      );
      y += 5;
      doc.text(
        `Tarif: ${formatHoursPeriodTotal(detailTotals.totalTariffHours)} / ${formatKc(detailTotals.totalTariffKc)} | Mimo tarif (docházka − tarify): ${formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffOnly)} | Zakázky: ${formatHoursPeriodTotal(detailTotals.totalJobHours)} / ${formatKc(detailTotals.totalJobKc)} | Mimo tarif i zakázku: ${formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffJob)} / ${formatKc(detailTotals.totalStandardKc)}`,
        margin,
        y
      );
      y += 10;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      for (const day of dailyDetailRows) {
        if (y > 250) {
          doc.addPage();
          y = 18;
        }
        doc.setFont("helvetica", "bold");
        doc.text(day.dayTitle, margin, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.text(
          `Prichod: ${day.prichod}   Odchod: ${day.odchod}   Odpracováno: ${formatHours(day.odpracovanoH)}   Záznamů: ${day.bloku}`,
          margin,
          y
        );
        y += 4;
        doc.text(
          `Tarify (součet hodin): ${formatHoursMinutes(day.tariffHoursTotal)}   Mimo tarif (docházka − tarify): ${formatHoursMinutes(day.hoursOutsideTariffOnly)}`,
          margin,
          y
        );
        y += 4;
        for (const t of day.tariffSegments) {
          doc.text(
            `  ${t.label}: ${t.startHm}-${t.endLabel} ${formatHoursMinutes(t.durationH)} ${formatRateKcPerH(t.rateKcPerH)} ${formatKc(t.earningsKc)}`,
            margin,
            y
          );
          y += 4;
          if (y > 275) {
            doc.addPage();
            y = 18;
          }
        }
        for (const j of day.jobSegments) {
          doc.text(
            `  ${j.label}: ${j.startHm}-${j.endLabel} ${formatHoursMinutes(j.durationH)} ${formatRateKcPerH(j.rateKcPerH)} ${formatKc(j.earningsKc)}`,
            margin,
            y
          );
          y += 4;
          if (y > 275) {
            doc.addPage();
            y = 18;
          }
        }
        doc.text(
          `  Mimo tarif/zakázku: ${formatHours(day.hoursOutsideTariffAndJob)} ${formatKc(day.orientacniKcStandard)} | Tarify celkem: ${formatKc(day.orientacniKcTariff)} | Zakázky celkem: ${formatKc(day.orientacniKcJob)}`,
          margin,
          y
        );
        y += 4;
        const schLabel =
          day.schvalenoStatus === "pending"
            ? " (ceká na schválení)"
            : day.schvalenoStatus === "none" && (day.odpracovanoH ?? 0) > 0
              ? " (neodsouhlaseno)"
              : "";
        doc.text(
          `Orientacní výdělek: ${formatKc(day.orientacniKc)}   Schválený výdělek: ${formatKc(day.schvalenoKc)}${schLabel}`,
          margin,
          y
        );
        y += 8;
      }
    } else {
      doc.setFont("helvetica", "bold");
      doc.text(
        `Celkem odpracováno: ${formatHours(aggregateTotals.hours)} | Schválený výdělek: ${formatKc(aggregateTotals.approvedKc)} | Orientační: ${formatKc(aggregateTotals.pendingKc)}`,
        margin,
        y
      );
      y += 10;

      doc.setFontSize(9);
      const col = [
        margin,
        margin + 42,
        margin + 78,
        margin + 98,
        margin + 118,
        margin + 138,
        margin + 162,
        margin + 186,
      ];
      doc.setFont("helvetica", "bold");
      doc.text("Datum / období", col[0], y);
      doc.text("Jméno", col[1], y);
      doc.text("Příchod", col[2], y);
      doc.text("Odchod", col[3], y);
      doc.text("Hodiny", col[4], y);
      doc.text("Záznamů", col[5], y);
      doc.text("Schváleno", col[6], y);
      doc.text("Orientačně", col[7], y);
      y += 5;
      doc.setFont("helvetica", "normal");

      for (const row of tableRows) {
        if (y > 275) {
          doc.addPage();
          y = 18;
        }
        const line = [
          row.datumLabel.slice(0, 28),
          row.employeeName.slice(0, 22),
          row.prichod,
          row.odchod,
          formatHours(row.odpracovanoH),
          String(row.bloku),
          formatKc(row.schvalenoKc),
          formatKc(row.orientacniKc),
        ];
        doc.text(line[0], col[0], y);
        doc.text(line[1], col[1], y);
        doc.text(line[2], col[2], y);
        doc.text(line[3], col[3], y);
        doc.text(line[4], col[4], y);
        doc.text(line[5], col[5], y);
        doc.text(line[6], col[6], y);
        doc.text(line[7], col[7], y);
        y += 5;
      }
    }

    doc.save(`dochazka-prehled-${rangeStr.start}-${rangeStr.end}.pdf`);
    toast({ title: "PDF vygenerováno", description: "Soubor byl stažen." });
  }, [
    aggregateTotals.approvedKc,
    aggregateTotals.hours,
    aggregateTotals.pendingKc,
    companyId,
    companyName,
    dailyDetailRows,
    detailTotals,
    employeeLabel,
    periodTitle,
    range.label,
    rangeStr.end,
    rangeStr.start,
    showEmployeeDetail,
    tableRows,
    toast,
  ]);

  const shiftAnchor = (deltaDays: number) => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + deltaDays);
    setAnchorDate(format(dt, "yyyy-MM-dd"));
  };

  if (!user) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profileLoading && !isPrivileged) {
    return null;
  }

  const pdfDisabled =
    loading ||
    (showEmployeeDetail
      ? !dailyDetailRows || dailyDetailRows.length === 0
      : tableRows.length === 0);

  const dataLoadIssues = useMemo(() => {
    const list: string[] = [];
    if (employeesError) list.push("zaměstnanci");
    if (attendanceError) list.push("docházka");
    if (dailyReportsError) list.push("denní výkazy");
    if (workBlocksError) list.push("bloky práce");
    if (workSegmentsError) list.push("úseky práce / tarify");
    return list;
  }, [
    employeesError,
    attendanceError,
    dailyReportsError,
    workBlocksError,
    workSegmentsError,
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10 text-black print:max-w-none">
      <div className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Přehled docházky a výdělků
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {companyName && companyName !== "Organization" ? companyName : ""}
            {range.label ? ` · ${range.label}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] border-black bg-white text-black hover:bg-neutral-100"
            onClick={handlePrint}
            disabled={loading}
          >
            <Printer className="mr-2 h-4 w-4" />
            Tisk
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] border-black bg-white text-black hover:bg-neutral-100"
            onClick={handlePdf}
            disabled={pdfDisabled}
          >
            <FileDown className="mr-2 h-4 w-4" />
            Export do PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-black bg-white p-4 shadow-sm print:hidden sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs font-medium text-neutral-600">Období</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["day", "week", "month", "custom"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={periodMode === m ? "default" : "outline"}
                className={
                  periodMode === m
                    ? "bg-black text-white hover:bg-black/90"
                    : "border-black bg-white text-black"
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
            <Label className="text-xs font-medium text-neutral-600">Datum od – do</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="max-w-[160px] border-black bg-white text-black"
                aria-label="Datum od"
              />
              <span className="text-neutral-500">–</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="max-w-[160px] border-black bg-white text-black"
                aria-label="Datum do"
              />
            </div>
          </div>
        ) : (
          <div className="sm:col-span-2 lg:col-span-2">
            <Label htmlFor="anchor-date" className="text-xs font-medium text-neutral-600">
              Datum / návěstí období
            </Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 shrink-0 border-black"
                onClick={() => shiftAnchor(-1)}
                aria-label="Předchozí"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                id="anchor-date"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
                className="max-w-[200px] border-black bg-white text-black"
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-10 w-10 shrink-0 border-black"
                onClick={() => shiftAnchor(1)}
                aria-label="Další"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs font-medium text-neutral-600">Zaměstnanec</Label>
          <Select
            value={employeeFilter}
            onValueChange={setEmployeeFilter}
            disabled={loading || employees.size === 0}
          >
            <SelectTrigger className="mt-2 border-black bg-white text-black">
              <SelectValue placeholder="Vyberte" />
            </SelectTrigger>
            <SelectContent className="border-black bg-white text-black">
              <SelectItem value={ALL}>Všichni zaměstnanci</SelectItem>
              {[...employees.values()].map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {dataLoadIssues.length > 0 && (
        <Alert
          className="border-amber-300 bg-amber-50 text-amber-950 print:hidden [&>svg]:text-amber-800"
          variant="default"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Část dat se nepodařila načíst</AlertTitle>
          <AlertDescription className="text-sm">
            Přehled se zobrazí s dostupnými údaji. Chybí nebo jsou nedostupná:{" "}
            <span className="font-medium">{dataLoadIssues.join(", ")}</span>.
            {workSegmentsError && (
              <span className="mt-1 block">
                Rozpis tarifů za den vyžaduje oprávnění ke kolekci úseků práce (work_segments); bez
                ní zůstanou jen docházka a výdělky z výkazů.
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div
        className={`sticky top-0 z-10 grid gap-3 border-b border-neutral-200 bg-white pb-3 sm:grid-cols-2 ${showEmployeeDetail && detailTotals ? "lg:grid-cols-4" : "lg:grid-cols-3"} print:static print:border-0 print:pb-0`}
      >
        {showEmployeeDetail && detailTotals ? (
          <>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Počet dnů s prací
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{detailTotals.daysWorked}</p>
            </div>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Celkem odpracováno
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {formatHours(detailTotals.hours)}
              </p>
            </div>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Schválený výdělek
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-black">
                {formatKc(detailTotals.approvedKc)}
              </p>
            </div>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Orientační výdělek
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-black">
                {formatKc(detailTotals.orientacniKc)}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Celkem odpracováno
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums">
                {formatHours(aggregateTotals.hours)}
              </p>
            </div>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Schválený výdělek
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-black">
                {formatKc(aggregateTotals.approvedKc)}
              </p>
            </div>
            <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
                Orientační výdělek
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-black">
                {formatKc(aggregateTotals.pendingKc)}
              </p>
            </div>
          </>
        )}
      </div>

      {showEmployeeDetail && detailTotals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 print:grid-cols-3 print:gap-2">
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Čas na tarifech
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {formatHoursMinutes(detailTotals.totalTariffHours)}
            </p>
          </div>
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Výdělek z tarifů
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatKc(detailTotals.totalTariffKc)}</p>
          </div>
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Čas mimo tarif (docházka − tarify)
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffOnly)}
            </p>
          </div>
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Čas na zakázkách
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {formatHoursMinutes(detailTotals.totalJobHours)}
            </p>
          </div>
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Výdělek zakázky
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatKc(detailTotals.totalJobKc)}</p>
          </div>
          <div className="rounded-lg border border-black bg-white p-3 shadow-sm print:p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
              Mimo tarif i zakázku (standard)
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums leading-tight">
              {formatHoursPeriodTotal(detailTotals.totalHoursOutsideTariffJob)} · {formatKc(detailTotals.totalStandardKc)}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2 text-black print:hidden">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Načítání dat…</span>
        </div>
      ) : showEmployeeDetail && dailyDetailRows ? (
        <>
          <div className="mb-2 hidden text-sm font-semibold text-black print:block">
            {employeeLabel} · {range.label}
          </div>
          <div className="hidden space-y-4 md:block print:block">
            {dailyDetailRows.map((day) => (
              <div
                key={day.key}
                className="break-inside-avoid rounded-lg border border-black bg-white p-4 shadow-sm print:shadow-none print:break-inside-avoid"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/15 pb-2">
                  <h3 className="text-base font-semibold capitalize text-black">{day.dayTitle}</h3>
                  <span className="text-sm text-neutral-600">
                    Záznamů docházky: {day.bloku}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium text-neutral-600">Příchod</p>
                    <p className="text-lg font-semibold tabular-nums">{day.prichod}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-neutral-600">Odchod</p>
                    <p className="text-lg font-semibold tabular-nums">{day.odchod}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-neutral-600">Odpracováno (docházka)</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatHours(day.odpracovanoH)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-neutral-600">Čas na tarifech (součet)</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatHoursMinutes(day.tariffHoursTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-neutral-600">
                      Čas mimo tarif (docházka − tarify)
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatHoursMinutes(day.hoursOutsideTariffOnly)}
                    </p>
                  </div>
                </div>

                {day.tariffSegments.length > 0 && (
                  <div className="mt-4 border-t border-black/10 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
                      Tarifní úseky
                    </p>
                    <ul className="mt-2 space-y-2 text-sm">
                      {day.tariffSegments.map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-col gap-0.5 rounded-md border border-black/10 bg-neutral-50/80 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2"
                        >
                          <span className="font-medium text-black">{t.label}</span>
                          <span className="tabular-nums text-neutral-800">
                            {t.startHm}–{t.endLabel}
                            {", "}
                            {formatHoursMinutes(t.durationH)}
                            {", "}
                            {formatRateKcPerH(t.rateKcPerH)}
                            {", "}
                            <span className="font-semibold">{formatKc(t.earningsKc)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {day.jobSegments.length > 0 && (
                  <div className="mt-4 border-t border-black/10 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-800">
                      Zakázky (sazba zakázky, ne tarif)
                    </p>
                    <ul className="mt-2 space-y-2 text-sm">
                      {day.jobSegments.map((j) => (
                        <li
                          key={j.id}
                          className="flex flex-col gap-0.5 rounded-md border border-black/10 bg-white px-3 py-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-2"
                        >
                          <span className="font-medium text-black">{j.label}</span>
                          <span className="tabular-nums text-neutral-800">
                            {j.startHm}–{j.endLabel}
                            {", "}
                            {formatHoursMinutes(j.durationH)}
                            {", "}
                            {formatRateKcPerH(j.rateKcPerH)}
                            {", "}
                            <span className="font-semibold">{formatKc(j.earningsKc)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 border-t border-black/10 pt-3 text-sm">
                  <p className="text-xs font-semibold text-neutral-800">Orientační výdělek (rozpad)</p>
                  <ul className="mt-1 space-y-1 text-neutral-900">
                    <li className="flex justify-between gap-4">
                      <span>
                        Mimo tarif i zakázku – standard ({formatHours(day.hoursOutsideTariffAndJob)})
                      </span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcStandard)}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>Z tarifů</span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcTariff)}</span>
                    </li>
                    <li className="flex justify-between gap-4">
                      <span>Ze zakázek</span>
                      <span className="font-semibold tabular-nums">{formatKc(day.orientacniKcJob)}</span>
                    </li>
                    <li className="flex justify-between gap-4 border-t border-black/10 pt-1 font-bold">
                      <span>Celkem orientačně</span>
                      <span className="tabular-nums">{formatKc(day.orientacniKc)}</span>
                    </li>
                  </ul>
                </div>

                <div className="mt-3 flex flex-wrap gap-6 text-sm sm:text-base">
                  <div>
                    <span className="text-neutral-600">Schválený výdělek: </span>
                    <span className="font-bold tabular-nums">
                      {day.schvalenoKc > 0
                        ? formatKc(day.schvalenoKc)
                        : day.schvalenoStatus === "pending"
                          ? "čeká na schválení"
                          : (day.odpracovanoH ?? 0) > 0
                            ? "neodsouhlaseno"
                            : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 md:hidden print:hidden">
            {dailyDetailRows.map((day) => (
              <Collapsible key={day.key} defaultOpen={false} className="group rounded-lg border border-black bg-white">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold">
                  <span className="capitalize">{day.dayTitle}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-black/15 px-4 pb-4">
                  <div className="grid grid-cols-2 gap-2 pt-3 text-sm">
                    <div>
                      <span className="text-neutral-600">Příchod</span>
                      <p className="font-medium">{day.prichod}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Odchod</span>
                      <p className="font-medium">{day.odchod}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Odpracováno</span>
                      <p className="font-medium">{formatHours(day.odpracovanoH)}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Záznamů</span>
                      <p className="font-medium">{day.bloku}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-neutral-600">Tarify / mimo tarif</span>
                      <p className="font-medium">
                        {formatHoursMinutes(day.tariffHoursTotal)} /{" "}
                        {formatHoursMinutes(day.hoursOutsideTariffOnly)}
                      </p>
                    </div>
                  </div>
                  {day.tariffSegments.map((t) => (
                    <div key={t.id} className="mt-2 rounded border border-black/10 bg-neutral-50/80 px-2 py-1.5 text-xs">
                      <span className="font-medium">{t.label}</span>
                      <div className="tabular-nums text-neutral-800">
                        {t.startHm}–{t.endLabel} · {formatHoursMinutes(t.durationH)} ·{" "}
                        {formatRateKcPerH(t.rateKcPerH)} · {formatKc(t.earningsKc)}
                      </div>
                    </div>
                  ))}
                  {day.jobSegments.map((j) => (
                    <div key={j.id} className="mt-2 rounded border border-black/10 px-2 py-1.5 text-xs">
                      <span className="font-medium">{j.label}</span>
                      <div className="tabular-nums text-neutral-800">
                        {j.startHm}–{j.endLabel} · {formatHoursMinutes(j.durationH)} ·{" "}
                        {formatRateKcPerH(j.rateKcPerH)} · {formatKc(j.earningsKc)}
                      </div>
                    </div>
                  ))}
                  <div className="mt-3 flex flex-col gap-1 border-t border-black/10 pt-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Mimo tarif i zak.</span>
                      <span>{formatKc(day.orientacniKcStandard)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Tarify</span>
                      <span>{formatKc(day.orientacniKcTariff)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-600">Zakázky</span>
                      <span>{formatKc(day.orientacniKcJob)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span className="text-neutral-600">Orientačně</span>
                      <span>{formatKc(day.orientacniKc)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span className="text-neutral-600">Schváleno</span>
                      <span>
                        {day.schvalenoKc > 0
                          ? formatKc(day.schvalenoKc)
                          : day.schvalenoStatus === "pending"
                            ? "čeká"
                            : (day.odpracovanoH ?? 0) > 0
                              ? "neodsouhl."
                              : "—"}
                      </span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-black bg-white md:block print:block">
            <Table>
              <TableHeader>
                <TableRow className="border-black hover:bg-transparent">
                  <TableHead className="text-black">Období / datum</TableHead>
                  <TableHead className="text-black">Zaměstnanec</TableHead>
                  <TableHead className="text-black">Příchod</TableHead>
                  <TableHead className="text-black">Odchod</TableHead>
                  <TableHead className="text-black">Odpracováno</TableHead>
                  <TableHead className="text-black">Záznamů</TableHead>
                  <TableHead className="text-right text-black">Schváleno</TableHead>
                  <TableHead className="text-right text-black">Orientačně</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-neutral-600">
                      Žádná data pro zvolené filtry.
                    </TableCell>
                  </TableRow>
                ) : (
                  tableRows.map((row) => (
                    <TableRow key={row.key} className="border-black/20">
                      <TableCell className="max-w-[200px] text-sm">{row.datumLabel}</TableCell>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell>{row.prichod}</TableCell>
                      <TableCell>{row.odchod}</TableCell>
                      <TableCell>{formatHours(row.odpracovanoH)}</TableCell>
                      <TableCell>{row.bloku}</TableCell>
                      <TableCell className="text-right text-lg font-semibold tabular-nums">
                        {formatKc(row.schvalenoKc)}
                      </TableCell>
                      <TableCell className="text-right text-lg font-semibold tabular-nums">
                        {formatKc(row.orientacniKc)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden print:hidden">
            {tableRows.length === 0 ? (
              <p className="rounded-lg border border-black bg-white p-4 text-center text-sm text-neutral-600">
                Žádná data pro zvolené filtry.
              </p>
            ) : (
              tableRows.map((row) => (
                <div
                  key={row.key}
                  className="space-y-2 rounded-lg border border-black bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-neutral-600">{row.datumLabel}</p>
                      <p className="font-semibold">{row.employeeName}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-neutral-600">Příchod</span>
                      <p>{row.prichod}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Odchod</span>
                      <p>{row.odchod}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Hodiny</span>
                      <p>{formatHours(row.odpracovanoH)}</p>
                    </div>
                    <div>
                      <span className="text-neutral-600">Záznamů</span>
                      <p>{row.bloku}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 border-t border-black/15 pt-2">
                    <div className="flex justify-between text-lg font-bold">
                      <span className="text-neutral-600">Schváleno</span>
                      <span>{formatKc(row.schvalenoKc)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold">
                      <span className="text-neutral-600">Orientačně</span>
                      <span>{formatKc(row.orientacniKc)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
