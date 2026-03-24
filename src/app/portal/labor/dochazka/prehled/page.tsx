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
import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { Loader2, FileDown, ChevronLeft, ChevronRight } from "lucide-react";
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
import {
  buildEmployeeMap,
  buildOverviewRows,
  computePeriodRange,
  formatKc,
  totalsFromRows,
  type PeriodMode,
} from "@/lib/attendance-overview-compute";

const ALL = "__all__";

function formatHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  return `${h} h`;
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
  const [employeeFilter, setEmployeeFilter] = useState<string>(ALL);

  const anchor = useMemo(() => {
    const [y, m, d] = anchorDate.split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  }, [anchorDate]);

  const range = useMemo(
    () => computePeriodRange(periodMode, anchor),
    [periodMode, anchor]
  );

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

  const { data: employeesRaw = [], isLoading: employeesLoading } =
    useCollection(employeesQuery);

  const employees = useMemo(
    () => buildEmployeeMap(Array.isArray(employeesRaw) ? employeesRaw : []),
    [employeesRaw]
  );

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    if (employeeFilter !== ALL) {
      return query(
        base,
        where("employeeId", "==", employeeFilter),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(8000)
      );
    }
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(8000)
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end, employeeFilter]);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "daily_work_reports");
    if (employeeFilter !== ALL) {
      return query(
        base,
        where("employeeId", "==", employeeFilter),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(8000)
      );
    }
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(8000)
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end, employeeFilter]);

  const workBlocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "work_time_blocks");
    if (employeeFilter !== ALL) {
      return query(
        base,
        where("employeeId", "==", employeeFilter),
        where("date", ">=", rangeStr.start),
        where("date", "<=", rangeStr.end),
        limit(8000)
      );
    }
    return query(
      base,
      where("date", ">=", rangeStr.start),
      where("date", "<=", rangeStr.end),
      limit(8000)
    );
  }, [firestore, companyId, rangeStr.start, rangeStr.end, employeeFilter]);

  const { data: attendanceData = [], isLoading: attLoading } =
    useCollection(attendanceQuery);
  const { data: dailyReportsData = [], isLoading: drLoading } =
    useCollection(dailyReportsQuery);
  const { data: workBlocksData = [], isLoading: wbLoading } =
    useCollection(workBlocksQuery);

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

  const tableRows = useMemo(
    () =>
      buildOverviewRows({
        mode: periodMode,
        range,
        employeeFilterId: employeeFilter === ALL ? "__all__" : employeeFilter,
        attendanceRaw: attendanceRows,
        employees,
        dailyReports,
        workBlocks,
      }),
    [
      periodMode,
      range,
      employeeFilter,
      attendanceRows,
      employees,
      dailyReports,
      workBlocks,
    ]
  );

  const totals = useMemo(() => totalsFromRows(tableRows), [tableRows]);

  const loading =
    profileLoading ||
    !companyId ||
    employeesLoading ||
    attLoading ||
    drLoading ||
    wbLoading;

  const employeeLabel =
    employeeFilter === ALL
      ? "Všichni zaměstnanci"
      : employees.get(employeeFilter)?.displayName ?? employeeFilter;

  const periodTitle =
    periodMode === "day"
      ? "Denní přehled"
      : periodMode === "week"
        ? "Týdenní přehled"
        : "Měsíční přehled";

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
    doc.setFont("helvetica", "bold");
    doc.text(
      `Celkem odpracováno: ${formatHours(totals.hours)} | Schválený výdělek: ${formatKc(totals.approvedKc)} | Orientační: ${formatKc(totals.pendingKc)}`,
      margin,
      y
    );
    y += 10;

    doc.setFontSize(9);
    const col = [margin, margin + 42, margin + 78, margin + 98, margin + 118, margin + 138, margin + 162, margin + 186];
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

    doc.save(`dochazka-prehled-${rangeStr.start}-${rangeStr.end}.pdf`);
    toast({ title: "PDF vygenerováno", description: "Soubor byl stažen." });
  }, [
    companyId,
    companyName,
    employeeLabel,
    periodTitle,
    range.label,
    rangeStr.end,
    rangeStr.start,
    tableRows,
    toast,
    totals.approvedKc,
    totals.hours,
    totals.pendingKc,
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10 text-black">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Přehled docházky a výdělků
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {companyName && companyName !== "Organization" ? companyName : ""}
            {range.label ? ` · ${range.label}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px] border-black bg-white text-black hover:bg-neutral-100"
          onClick={handlePdf}
          disabled={loading || tableRows.length === 0}
        >
          <FileDown className="mr-2 h-4 w-4" />
          Generovat PDF
        </Button>
      </div>

      <div className="grid gap-4 rounded-lg border border-black bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label className="text-xs font-medium text-neutral-600">Období</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["day", "week", "month"] as const).map((m) => (
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
                {m === "day" ? "Den" : m === "week" ? "Týden" : "Měsíc"}
              </Button>
            ))}
          </div>
        </div>
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
            Celkem odpracováno
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{formatHours(totals.hours)}</p>
        </div>
        <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
            Schválený výdělek
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-black">
            {formatKc(totals.approvedKc)}
          </p>
        </div>
        <div className="rounded-lg border border-black bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-600">
            Orientační výdělek
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-black">
            {formatKc(totals.pendingKc)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center gap-2 text-black">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Načítání dat…</span>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-black bg-white md:block">
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

          <div className="space-y-3 md:hidden">
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
