"use client";

import React, { useMemo } from "react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, collection, query, where, limit } from "firebase/firestore";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Wallet } from "lucide-react";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
import {
  formatKc,
  getPayableHours,
  getLoggedHours,
  getReviewLabel,
  moneyForBlock,
  sumPayableHoursForBlocks,
  sumPaidAdvances,
  thisMonthRange,
  thisWeekRange,
  todayRange,
  type AdvanceDoc,
  type WorkTimeBlockMoney,
} from "@/lib/employee-money";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { WorkSegmentClient } from "@/lib/work-segment-client";
import {
  buildEmployeeDailyDetailRows,
  computePeriodRange,
  totalsFromDailyDetailRows,
  type EmployeeLite,
} from "@/lib/attendance-overview-compute";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JOB_TERMINAL_AUTO_APPROVAL_SOURCE } from "@/lib/job-terminal-auto-shared";
import { employeeDebtSelfViewAllowed } from "@/lib/employee-debt-visibility";
import Link from "next/link";

const MONEY_FETCH_LIMIT = 3000;

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

export default function EmployeeMoneyPage() {
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName, company } = useCompany();
  const showDebtSummary = useMemo(
    () => employeeDebtSelfViewAllowed(company),
    [company]
  );

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } =
    useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc } = useDoc<any>(employeeRef);

  const hourlyRate = useMemo(() => {
    const fromEmp = Number(employeeDoc?.hourlyRate);
    const fromUser = Number(profile?.hourlyRate);
    if (Number.isFinite(fromEmp) && fromEmp > 0) return fromEmp;
    if (Number.isFinite(fromUser) && fromUser > 0) return fromUser;
    return 0;
  }, [employeeDoc?.hourlyRate, profile?.hourlyRate]);

  const blocksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_time_blocks"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId]);

  const silentListen = { suppressGlobalPermissionError: true as const };

  const authUid =
    typeof user?.uid === "string" && user.uid.trim() ? user.uid.trim() : "";
  const needAltEmployeeKey =
    Boolean(employeeId) && Boolean(authUid) && employeeId !== authUid;

  const attendanceQueryPrimary = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", employeeId),
      limit(MONEY_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const attendanceQueryAlt = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltEmployeeKey) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("employeeId", "==", authUid),
      limit(MONEY_FETCH_LIMIT)
    );
  }, [firestore, companyId, needAltEmployeeKey, authUid]);

  const dailyReportsMoneyQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      limit(MONEY_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const segmentsQueryPrimary = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", employeeId),
      limit(MONEY_FETCH_LIMIT)
    );
  }, [firestore, companyId, employeeId]);

  const segmentsQueryAlt = useMemoFirebase(() => {
    if (!firestore || !companyId || !needAltEmployeeKey) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("employeeId", "==", authUid),
      limit(MONEY_FETCH_LIMIT)
    );
  }, [firestore, companyId, needAltEmployeeKey, authUid]);

  const { data: blocksRaw, isLoading: blocksLoading, error: blocksError } =
    useCollection(blocksQuery, silentListen);
  const { data: rawAttP = [], isLoading: attLoadP } = useCollection(
    attendanceQueryPrimary,
    silentListen
  );
  const { data: rawAttA = [], isLoading: attLoadA } = useCollection(
    attendanceQueryAlt,
    silentListen
  );
  const { data: dailyReportsMoneyRaw = [], isLoading: drMoneyLoading } =
    useCollection(dailyReportsMoneyQuery, silentListen);
  const { data: segP = [], isLoading: segLoadP } = useCollection(
    segmentsQueryPrimary,
    silentListen
  );
  const { data: segA = [], isLoading: segLoadA } = useCollection(
    segmentsQueryAlt,
    silentListen
  );

  const attLoadingMoney = attLoadP || (needAltEmployeeKey ? attLoadA : false);
  const segLoadingMoney = segLoadP || (needAltEmployeeKey ? segLoadA : false);

  const advancesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "advances"),
      where("employeeId", "==", employeeId),
      limit(200)
    );
  }, [firestore, companyId, employeeId]);

  const { data: advancesRaw, isLoading: advancesLoading, error: advancesError } =
    useCollection(advancesQuery, silentListen);
  const debtsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !showDebtSummary) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debts"),
      where("employeeId", "==", employeeId),
      limit(300)
    );
  }, [firestore, companyId, employeeId, showDebtSummary]);
  const debtPaymentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId || !showDebtSummary) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_debt_payments"),
      where("employeeId", "==", employeeId),
      limit(500)
    );
  }, [firestore, companyId, employeeId, showDebtSummary]);
  const { data: debtsRaw = [] } = useCollection(debtsQuery, silentListen);
  const { data: debtPaymentsRaw = [] } = useCollection(debtPaymentsQuery, silentListen);

  const blocks = useMemo(() => {
    const raw = Array.isArray(blocksRaw) ? blocksRaw : [];
    return raw.map((b: any) => ({ ...b, id: String(b?.id ?? "") }));
  }, [blocksRaw]);

  const advances = useMemo((): AdvanceDoc[] => {
    const raw = Array.isArray(advancesRaw) ? advancesRaw : [];
    return raw.map((a: any) => ({
      id: String(a?.id ?? ""),
      amount: Number(a.amount) || 0,
      date: String(a.date ?? ""),
      employeeId: String(a.employeeId ?? ""),
      companyId: String(a.companyId ?? ""),
      note: a.note != null ? String(a.note) : undefined,
      status: a.status === "paid" ? "paid" : "unpaid",
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      createdBy: a.createdBy != null ? String(a.createdBy) : undefined,
    }));
  }, [advancesRaw]);

  const blocksMoney = blocks as WorkTimeBlockMoney[];

  const rangeStrAll = useMemo(() => {
    const bumps = new Set<string>();
    for (const b of blocksMoney) {
      const d = String(b.date ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) bumps.add(d);
    }
    const mergedAtt = mergeDocsById<AttendanceRow>([
      (Array.isArray(rawAttP) ? rawAttP : []) as AttendanceRow[],
      (Array.isArray(rawAttA) ? rawAttA : []) as AttendanceRow[],
    ]);
    for (const raw of mergedAtt) {
      const ds =
        (typeof raw.date === "string" && raw.date.trim().slice(0, 10)) || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) bumps.add(ds);
    }
    const sorted = [...bumps].sort();
    if (sorted.length === 0) {
      const t = format(new Date(), "yyyy-MM-dd");
      return { start: t, end: t };
    }
    return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
  }, [blocksMoney, rawAttP, rawAttA]);

  const employeeDisplayMoney = useMemo(() => {
    const first = String(employeeDoc?.firstName ?? "").trim();
    const last = String(employeeDoc?.lastName ?? "").trim();
    const name = [first, last].filter(Boolean).join(" ").trim();
    return (
      name ||
      String(employeeDoc?.email ?? profile?.email ?? employeeId ?? "").trim()
    );
  }, [employeeDoc, profile?.email, employeeId]);

  const employeeLiteMoney: EmployeeLite | null = useMemo(() => {
    if (!employeeId) return null;
    const authFromDoc =
      typeof employeeDoc?.authUserId === "string"
        ? employeeDoc.authUserId.trim()
        : null;
    return {
      id: employeeId,
      displayName: employeeDisplayMoney || employeeId,
      hourlyRate,
      authUserId: authFromDoc || authUid || null,
    };
  }, [
    employeeId,
    employeeDisplayMoney,
    hourlyRate,
    employeeDoc?.authUserId,
    authUid,
  ]);

  const attendanceRowsMoney = useMemo(() => {
    const merged = mergeDocsById<AttendanceRow>([
      (Array.isArray(rawAttP) ? rawAttP : []) as AttendanceRow[],
      (Array.isArray(rawAttA) ? rawAttA : []) as AttendanceRow[],
    ]);
    return merged.filter((row) =>
      rowInDateRange(row, rangeStrAll.start, rangeStrAll.end)
    );
  }, [rawAttP, rawAttA, rangeStrAll.start, rangeStrAll.end]);

  const dailyReportsMoney = useMemo(() => {
    const raw = (Array.isArray(dailyReportsMoneyRaw)
      ? dailyReportsMoneyRaw
      : []) as Record<string, unknown>[];
    return raw.filter((row) =>
      rowInDateRange(row, rangeStrAll.start, rangeStrAll.end)
    );
  }, [dailyReportsMoneyRaw, rangeStrAll.start, rangeStrAll.end]);

  const workSegmentsMoney = useMemo(() => {
    const merged = mergeDocsById<WorkSegmentClient>([
      (Array.isArray(segP) ? segP : []) as WorkSegmentClient[],
      (Array.isArray(segA) ? segA : []) as WorkSegmentClient[],
    ]);
    return merged.filter((row) =>
      rowInDateRange(row, rangeStrAll.start, rangeStrAll.end)
    );
  }, [segP, segA, rangeStrAll.start, rangeStrAll.end]);

  const now = new Date();
  const tr = todayRange(now);
  const wr = thisWeekRange(now);
  const mr = thisMonthRange(now);

  const approvedHoursTotal = sumPayableHoursForBlocks(blocksMoney);
  const pendingHoursTotal = useMemo(() => {
    return (
      Math.round(
        blocksMoney
          .filter((b) => b.reviewStatus === "pending")
          .reduce((s, b) => s + getLoggedHours(b), 0) * 100
      ) / 100
    );
  }, [blocksMoney]);

  const earningsByRange = useMemo(() => {
    if (!employeeLiteMoney) {
      return { today: 0, week: 0, month: 0, all: 0 };
    }
    const mk = (from: Date, to: Date) => {
      const startIso = format(from, "yyyy-MM-dd");
      const endIso = format(to, "yyyy-MM-dd");
      const range = computePeriodRange("custom", from, { from, to });
      const att = attendanceRowsMoney.filter((r) =>
        rowInDateRange(r, startIso, endIso)
      );
      const dr = dailyReportsMoney.filter((r) =>
        rowInDateRange(r, startIso, endIso)
      );
      const wb = blocksMoney.filter((b) =>
        rowInDateRange(b, startIso, endIso)
      );
      const seg = workSegmentsMoney.filter((s) =>
        rowInDateRange(s, startIso, endIso)
      );
      const rows = buildEmployeeDailyDetailRows({
        range,
        employee: employeeLiteMoney,
        attendanceRaw: att,
        dailyReports: dr,
        workBlocks: wb,
        segments: seg,
      });
      return totalsFromDailyDetailRows(rows).approvedKc;
    };
    const n = new Date();
    const todayP = computePeriodRange("day", n);
    const weekP = computePeriodRange("week", n);
    const monthP = computePeriodRange("month", n);
    const allFrom = new Date(
      Number(rangeStrAll.start.slice(0, 4)),
      Number(rangeStrAll.start.slice(5, 7)) - 1,
      Number(rangeStrAll.start.slice(8, 10))
    );
    const allTo = new Date(
      Number(rangeStrAll.end.slice(0, 4)),
      Number(rangeStrAll.end.slice(5, 7)) - 1,
      Number(rangeStrAll.end.slice(8, 10)),
      23,
      59,
      59,
      999
    );
    return {
      today: mk(todayP.start, todayP.end),
      week: mk(weekP.start, weekP.end),
      month: mk(monthP.start, monthP.end),
      all: mk(allFrom, allTo),
    };
  }, [
    employeeLiteMoney,
    attendanceRowsMoney,
    dailyReportsMoney,
    blocksMoney,
    workSegmentsMoney,
    rangeStrAll.start,
    rangeStrAll.end,
  ]);

  const earnedToday = earningsByRange.today;
  const earnedWeek = earningsByRange.week;
  const earnedMonth = earningsByRange.month;
  const earnedAll = earningsByRange.all;

  const moneyDataLoading =
    blocksLoading || attLoadingMoney || drMoneyLoading || segLoadingMoney;

  const paidTotal = sumPaidAdvances(advances);
  const debtTotal = useMemo(
    () => Math.round(((Array.isArray(debtsRaw) ? debtsRaw : []) as any[]).reduce((s, d) => s + (Number(d?.amount) || 0), 0) * 100) / 100,
    [debtsRaw]
  );
  const debtRemaining = useMemo(
    () => Math.round(((Array.isArray(debtsRaw) ? debtsRaw : []) as any[]).reduce((s, d) => s + (Number(d?.remainingAmount) || 0), 0) * 100) / 100,
    [debtsRaw]
  );
  const debtRepaid = Math.max(0, Math.round((debtTotal - debtRemaining) * 100) / 100);
  const remaining = Math.max(0, Math.round((earnedAll - paidTotal) * 100) / 100);

  const sortedAdvances = useMemo(() => {
    return [...advances].sort((a, b) => b.date.localeCompare(a.date));
  }, [advances]);

  const sortedBlocks = useMemo(() => {
    return [...blocksMoney].sort((a, b) => {
      const da = String(a.date || "");
      const db = String(b.date || "");
      if (da !== db) return db.localeCompare(da);
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
  }, [blocksMoney]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-black">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium text-black">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Profil nebyl nalezen</AlertTitle>
        <AlertDescription>Kontaktujte administrátora.</AlertDescription>
      </Alert>
    );
  }

  if (!companyId || !employeeId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Chybí data účtu</AlertTitle>
        <AlertDescription>
          Pro zobrazení peněz je potřeba být přiřazen k firmě jako zaměstnanec.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-1 pb-10 sm:px-0">
      <div className="flex items-start gap-3">
        <Wallet className="mt-1 h-8 w-8 shrink-0 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-black sm:text-3xl">Peníze</h1>
          <p className="mt-1 text-base text-slate-800">
            Přehled výdělku ze schválených hodin a záloh.
            {companyName && companyName !== "Organization"
              ? ` · ${companyName}`
              : ""}
          </p>
        </div>
      </div>

      {(blocksError || advancesError) && (
        <Alert
          className="border-amber-300 bg-amber-50 text-amber-950"
          variant="default"
        >
          <AlertCircle className="h-4 w-4 text-amber-800" />
          <AlertTitle>Část dat se nepodařila načíst</AlertTitle>
          <AlertDescription className="text-amber-950">
            {isFirestoreIndexError(blocksError) || isFirestoreIndexError(advancesError)
              ? "Databáze momentálně nemůže vrátit všechna data (index nebo dočasný problém). Součty níže mohou být neúplné — zkuste stránku později."
              : "Zkuste obnovit stránku. Pokud problém přetrvává, kontaktujte administrátora."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Hodinová sazba
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-black">
              {hourlyRate > 0 ? `${hourlyRate} Kč/h` : "—"}
            </p>
            {hourlyRate <= 0 && (
              <p className="mt-1 text-xs text-slate-800">
                Sazba není nastavena — domluvte se s administrátorem.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Schválené hodiny (celkem)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-black">
              {blocksLoading ? "…" : `${approvedHoursTotal} h`}
            </p>
            {!blocksLoading && pendingHoursTotal > 0 && (
              <p className="mt-1 text-xs font-medium text-amber-800">
                Čeká na schválení: {pendingHoursTotal} h
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white shadow-sm sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-black">
              Schválený výdělek (docházka + tarify)
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="font-medium text-slate-700">Dnes</p>
              <p className="text-lg font-bold text-black">
                {moneyDataLoading ? "…" : formatKc(earnedToday)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Týden</p>
              <p className="text-lg font-bold text-black">
                {moneyDataLoading ? "…" : formatKc(earnedWeek)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Měsíc</p>
              <p className="text-lg font-bold text-black">
                {moneyDataLoading ? "…" : formatKc(earnedMonth)}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-700">Celkem</p>
              <p className="text-lg font-bold text-black">
                {moneyDataLoading ? "…" : formatKc(earnedAll)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-2 border-primary/25 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">Celkový přehled</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Celkem vyděláno
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {moneyDataLoading ? "…" : formatKc(earnedAll)}
            </p>
            <p className="text-xs text-slate-800">
              Dle docházky, tarifů a schválených výkazů (stejná logika jako v přehledu)
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Celkem vyplaceno
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {advancesLoading ? "…" : formatKc(paidTotal)}
            </p>
            <p className="text-xs text-slate-800">Součet záloh se stavem zaplaceno</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">
              Zbývá k vyplacení
            </p>
            <p className="mt-1 text-xl font-bold text-black">
              {moneyDataLoading || advancesLoading ? "…" : formatKc(remaining)}
            </p>
            <p className="text-xs text-emerald-900">
              vyděláno − vyplacené zálohy
            </p>
          </div>
          {showDebtSummary ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-semibold text-rose-900">Dluhy (souhrn)</p>
              <p className="mt-1 text-xl font-bold text-black">{formatKc(debtTotal)}</p>
              <p className="text-xs text-rose-900">
                Splaceno {formatKc(debtRepaid)} · zbývá {formatKc(debtRemaining)}
              </p>
              <p className="mt-3 text-xs text-rose-950">
                <Link
                  href="/portal/employee/profile#employee-debts"
                  className="font-medium underline underline-offset-2 hover:text-rose-900"
                >
                  Jednotlivé dluhy, poznámky a splátky — zobrazit na profilu
                </Link>
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">Zálohy (výplaty)</CardTitle>
        </CardHeader>
        <CardContent>
          {advancesLoading ? (
            <div className="flex items-center gap-2 text-black">
              <Loader2 className="h-6 w-6 animate-spin" />
              Načítání…
            </div>
          ) : sortedAdvances.length === 0 ? (
            <p className="text-base text-slate-800">
              Zatím nemáte evidované žádné zálohy.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-3 md:hidden">
                {sortedAdvances.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-lg font-bold text-black">
                        {formatKc(a.amount)}
                      </span>
                      <Badge
                        className={
                          a.status === "paid"
                            ? "bg-emerald-600 text-white hover:bg-emerald-600"
                            : "bg-red-600 text-white hover:bg-red-600"
                        }
                      >
                        {a.status === "paid" ? "Zaplaceno" : "Nezaplaceno"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-medium text-black">
                      Datum: {a.date || "—"}
                    </p>
                    {a.note ? (
                      <p className="mt-1 text-sm text-slate-800">{a.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-md border border-slate-200 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-black">Datum</TableHead>
                      <TableHead className="text-black">Částka</TableHead>
                      <TableHead className="text-black">Stav</TableHead>
                      <TableHead className="text-black">Poznámka</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedAdvances.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium text-black">
                          {a.date || "—"}
                        </TableCell>
                        <TableCell className="font-bold text-black">
                          {formatKc(a.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              a.status === "paid"
                                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                                : "bg-red-600 text-white hover:bg-red-600"
                            }
                          >
                            {a.status === "paid" ? "Zaplaceno" : "Nezaplaceno"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs text-black">
                          {a.note || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-black">
            Výkazy práce (přehled)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {blocksLoading ? (
            <div className="flex items-center gap-2 text-black">
              <Loader2 className="h-6 w-6 animate-spin" />
              Načítání…
            </div>
          ) : sortedBlocks.length === 0 ? (
            <p className="text-base text-slate-800">Žádné záznamy výkazu.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-3 lg:hidden">
                {sortedBlocks.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg border border-slate-300 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-black">{b.date}</span>
                      <Badge variant="secondary" className="font-semibold">
                        {getReviewLabel(b.reviewStatus)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-black">
                      {b.startTime} – {b.endTime} · zápis {b.hours ?? "—"} h ·
                      schváleno {getPayableHours(b)} h
                      {hourlyRate > 0 && getPayableHours(b) > 0
                        ? ` · ${formatKc(moneyForBlock(b, hourlyRate))}`
                        : ""}
                    </p>
                    {(b.reviewStatus === "adjusted" || b.reviewStatus === "approved") &&
                    (b.adminNote || b.adjustmentReason) ? (
                      <p className="mt-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-900">
                        {b.adminNote ? (
                          <span className="block">
                            <span className="font-semibold">Poznámka:</span>{" "}
                            {b.adminNote}
                          </span>
                        ) : null}
                        {b.adjustmentReason ? (
                          <span className="mt-0.5 block">
                            <span className="font-semibold">Úprava:</span>{" "}
                            {b.adjustmentReason}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-slate-800">
                      {b.description || "—"}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto rounded-md border border-slate-200 lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-black">Datum</TableHead>
                      <TableHead className="text-black">Čas</TableHead>
                      <TableHead className="text-black">Hodiny</TableHead>
                      <TableHead className="text-black">Schv. h</TableHead>
                      <TableHead className="text-black">Stav</TableHead>
                      <TableHead className="text-black">Platba</TableHead>
                      <TableHead className="text-black">Částka</TableHead>
                      <TableHead className="text-black">Popis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedBlocks.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium text-black">
                          {b.date}
                        </TableCell>
                        <TableCell className="text-black">
                          {b.startTime} – {b.endTime}
                        </TableCell>
                        <TableCell className="text-black">{b.hours ?? "—"}</TableCell>
                        <TableCell className="text-black">
                          {b.reviewStatus === "pending"
                            ? "—"
                            : (b.approvedHours ?? b.hours ?? "—")}
                        </TableCell>
                        <TableCell className="text-black">
                          <span className="inline-flex flex-col gap-1">
                            <span>{getReviewLabel(b.reviewStatus)}</span>
                            {b.approvedAutomatically === true &&
                            String(b.approvalSource ?? "") === JOB_TERMINAL_AUTO_APPROVAL_SOURCE ? (
                              <Badge variant="outline" className="w-fit text-xs font-normal">
                                Automaticky schváleno
                              </Badge>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className={b.paid === true ? "bg-emerald-600 text-white hover:bg-emerald-600" : "bg-slate-200 text-black hover:bg-slate-200"}>
                            {b.paid === true ? "Zaplaceno" : "Nezaplaceno"}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-black">
                          {hourlyRate > 0 && getPayableHours(b) > 0
                            ? formatKc(moneyForBlock(b, hourlyRate))
                            : "—"}
                        </TableCell>
                        <TableCell className="max-w-[200px] text-black">
                          <span className="block truncate">
                            {b.description || "—"}
                          </span>
                          {(b.adminNote || b.adjustmentReason) && (
                            <span className="mt-1 block truncate text-xs text-slate-700">
                              {b.adminNote || b.adjustmentReason}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
