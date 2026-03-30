"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  Briefcase,
  Clock,
  Wallet,
  Activity,
  ArrowRight,
  AlertCircle,
  MessageSquare,
  Banknote,
  PieChart,
  Inbox,
  FileText,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useUser,
  useFirestore,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import { collection, query, orderBy, limit, where } from "firebase/firestore";
import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { useRouter } from "next/navigation";
import {
  resolveJobBudgetFromFirestore,
  resolveJobPaidFromFirestore,
  roundMoney2,
} from "@/lib/vat-calculations";
import {
  isFinancialCompanyDocument,
  type CompanyDocumentLike,
} from "@/lib/company-documents-financial";
import {
  formatKc,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
} from "@/lib/employee-money";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";
import { CompanyScheduleCalendar } from "@/components/portal/company-schedule-calendar";
import { DashboardJobTasksWidget } from "@/components/jobs/dashboard-job-tasks-widget";
import { DashboardTerminalActiveWidget } from "@/components/portal/dashboard-terminal-active-widget";
import { DashboardDocumentsToPayWidget } from "@/components/portal/dashboard-documents-to-pay-widget";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import type { AttendanceRow } from "@/lib/employee-attendance";
import { sumOrientacniCenyFromLeadRows } from "@/lib/lead-estimated-price";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { InquiryTypeBadge } from "@/components/inquiry-type-badge";
import { cn } from "@/lib/utils";

const DASHBOARD_LEADS_POLL_MS = 60_000;

function receivedAtToMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toMillis" in raw &&
    typeof (raw as { toMillis: () => number }).toMillis === "function"
  ) {
    return (raw as { toMillis: () => number }).toMillis();
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    return (raw as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

function leadNewestTimestampMs(
  lead: LeadImportRow,
  overlay?: { receivedAt?: unknown }
): number {
  if (lead.receivedAtIso) {
    const t = Date.parse(lead.receivedAtIso);
    if (!Number.isNaN(t)) return t;
  }
  const ms = receivedAtToMs(overlay?.receivedAt);
  return ms ?? 0;
}

function formatLeadListDate(ms: number): string {
  if (ms <= 0) return "—";
  return new Date(ms).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

type ProfileData = {
  displayName?: string;
  companyId?: string;
  role?: string;
  employeeId?: string;
};

type JobData = {
  id: string;
  name?: string;
  status?: string;
  budget?: unknown;
  assignedEmployeeIds?: string[];
  customerId?: string;
  /** YYYY-MM-DD — předpokládané dokončení */
  endDate?: string;
  customerName?: string;
  customerAddress?: string;
};

type PendingDocumentRow = {
  id: string;
  fileName?: string | null;
  fileType?: string | null;
  uploadedByName?: string | null;
  createdAt?: unknown;
  assignmentType?: string | null;
};

export default function CompanyDashboard() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const firestore = useFirestore();

  const {
    userProfile: profile,
    profileLoading: isProfileLoading,
    profileError,
    companyId: companyIdFromProfile,
    companyName,
    isLoading: companyContextLoading,
    companyDocMissing,
    companyError: companyLoadError,
  } = useCompany();

  const typedProfile = (profile as ProfileData | null) ?? null;
  const companyId = companyIdFromProfile ?? typedProfile?.companyId;
  const role = typedProfile?.role || "employee";

  const isManagement = ["owner", "admin", "manager"].includes(role);
  const isAccountant = role === "accountant";
  const isEmployee = role === "employee";
  const isCustomer = role === "customer";
  /** Přehledové KPI (zakázky, mzdy, finance, zprávy) — vedení a účetní. */
  const showAdminDashboard =
    (isManagement || isAccountant) && !isCustomer;

  const todayIso = useMemo(
    () => new Date().toISOString().split("T")[0],
    []
  );

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId, showAdminDashboard]);

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobs");
  }, [firestore, companyId]);

  const financeQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    if (!isManagement && !isAccountant) return null;
    return query(
      collection(firestore, "companies", companyId, "finance"),
      orderBy("date", "desc"),
      limit(500)
    );
  }, [firestore, companyId, isManagement, isAccountant]);

  const pendingDocumentsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "documents"),
      where("assignmentType", "==", "pending_assignment"),
      limit(8)
    );
  }, [firestore, companyId, showAdminDashboard]);

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    if (isManagement || isAccountant) {
      return query(base, orderBy("timestamp", "desc"), limit(100));
    }
    if (isEmployee && user) {
      const empId = typedProfile?.employeeId;
      const ids = [...new Set([empId, user.uid].filter(Boolean))] as string[];
      if (ids.length === 0) return null;
      if (ids.length === 1) {
        return query(
          base,
          where("employeeId", "==", ids[0]),
          orderBy("timestamp", "desc"),
          limit(100)
        );
      }
      return query(
        base,
        where("employeeId", "in", ids),
        orderBy("timestamp", "desc"),
        limit(100)
      );
    }
    return null;
  }, [
    firestore,
    companyId,
    isManagement,
    isAccountant,
    isEmployee,
    user,
    typedProfile?.employeeId,
  ]);

  const dailyWorkReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      limit(2500)
    );
  }, [firestore, companyId, showAdminDashboard]);

  const chatDashboardQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "chat"),
      orderBy("createdAt", "desc"),
      limit(500)
    );
  }, [firestore, companyId, showAdminDashboard]);

  const attendanceTodayForDashboardQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "attendance"),
      where("date", "==", todayIso),
      limit(4000)
    );
  }, [firestore, companyId, showAdminDashboard, todayIso]);

  /** Realtime: změny u poptávek (datum přijetí, štítky) — přepočet „nejnovějších“ na dashboardu. */
  const importLeadOverlaysQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return collection(firestore, "companies", companyId, "import_lead_overlays");
  }, [firestore, companyId, showAdminDashboard]);

  const { data: employeesRaw } = useCollection(employeesQuery);
  /** useCollection vrací `null` při načítání/chybě — default `= []` se na null nevztahuje. */
  const employees = employeesRaw ?? [];

  const {
    data: allJobsRaw,
    isLoading: isJobsLoading,
    error: jobsError,
  } = useCollection(jobsQuery);
  const {
    data: financeRowsRaw,
  } = useCollection(financeQuery);
  const { data: attendanceRowsRaw } = useCollection(attendanceQuery);
  const {
    data: dashboardDailyReportsRaw,
    isLoading: dailyReportsLoading,
  } = useCollection(dailyWorkReportsQuery);
  const {
    data: dashboardChatMessagesRaw,
    isLoading: chatDashboardLoading,
  } = useCollection(chatDashboardQuery);
  const {
    data: attendanceTodayRaw,
    isLoading: attendanceTodayLoading,
  } = useCollection(attendanceTodayForDashboardQuery);
  const { data: pendingDocumentsRaw } = useCollection(pendingDocumentsQuery);

  const openWorkSegmentsTodayQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "work_segments"),
      where("date", "==", todayIso),
      where("closed", "==", false)
    );
  }, [firestore, companyId, showAdminDashboard, todayIso]);

  const {
    data: openWorkSegmentsRaw,
    isLoading: openWorkSegmentsLoading,
  } = useCollection(openWorkSegmentsTodayQuery);

  const { data: importLeadOverlaysRaw } = useCollection(importLeadOverlaysQuery);

  const financeRows = financeRowsRaw ?? [];
  const attendanceRows = attendanceRowsRaw ?? [];
  const dashboardDailyReports = dashboardDailyReportsRaw ?? [];
  const dashboardChatMessages = dashboardChatMessagesRaw ?? [];
  const attendanceTodayRows = attendanceTodayRaw ?? [];
  const pendingDocuments = useMemo(() => {
    const rows = (pendingDocumentsRaw ?? []) as PendingDocumentRow[];
    const financial = rows.filter((r) =>
      isFinancialCompanyDocument(r as CompanyDocumentLike)
    );
    const toMs = (t: unknown) => {
      if (t && typeof (t as { toMillis?: () => number }).toMillis === "function") {
        return (t as { toMillis: () => number }).toMillis();
      }
      if (t && typeof (t as { seconds?: number }).seconds === "number") {
        return (t as { seconds: number }).seconds * 1000;
      }
      return 0;
    };
    return [...financial].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [pendingDocumentsRaw]);

  const typedJobs: JobData[] = Array.isArray(allJobsRaw)
    ? (allJobsRaw as JobData[])
    : [];

  const profileOrCompanyLoading =
    isProfileLoading || (Boolean(companyId) && companyContextLoading);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace("/login");
    }
  }, [isUserLoading, user, router]);

  const jobs = typedJobs.filter((job) => {
    if (isManagement || isAccountant) return true;
    if (isEmployee && user?.uid) {
      return job.assignedEmployeeIds?.includes(user.uid) ?? false;
    }
    if (isCustomer && user?.uid) {
      return job.customerId === user.uid;
    }
    return false;
  });

  const attendanceTodayCount = useMemo(() => {
    if (!attendanceRows?.length) return 0;
    return attendanceRows.filter(
      (a: { date?: string }) => a.date === todayIso
    ).length;
  }, [attendanceRows, todayIso]);

  const monthlyRevenueCzk = useMemo(() => {
    if (!financeRows?.length) return 0;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let sum = 0;
    for (const r of financeRows as { type?: string; amount?: unknown; date?: unknown }[]) {
      if (r.type !== "revenue") continue;
      const raw = r.date;
      let rd: Date | null = null;
      if (typeof raw === "string") {
        const t = Date.parse(raw);
        if (!Number.isNaN(t)) rd = new Date(t);
      } else if (
        raw &&
        typeof raw === "object" &&
        "toDate" in raw &&
        typeof (raw as { toDate: () => Date }).toDate === "function"
      ) {
        rd = (raw as { toDate: () => Date }).toDate();
      }
      if (!rd || rd.getFullYear() !== y || rd.getMonth() !== m) continue;
      sum += Number(r.amount) || 0;
    }
    return sum;
  }, [financeRows]);

  const jobsAggregate = useMemo(() => {
    let count = 0;
    let totalBudgetNetKc = 0;
    let totalBudgetGrossKc = 0;
    let totalPaidNetKc = 0;
    let totalPaidGrossKc = 0;
    for (const j of typedJobs) {
      count += 1;
      const bd = resolveJobBudgetFromFirestore(j as Record<string, unknown>);
      if (bd) {
        totalBudgetNetKc += bd.budgetNet;
        totalBudgetGrossKc += bd.budgetGross;
      }
      const pd = resolveJobPaidFromFirestore(j as Record<string, unknown>);
      totalPaidNetKc += pd.paidNet;
      totalPaidGrossKc += pd.paidGross;
    }
    return {
      count,
      totalBudgetNetKc,
      totalBudgetGrossKc,
      totalPaidNetKc: roundMoney2(totalPaidNetKc),
      totalPaidGrossKc: roundMoney2(totalPaidGrossKc),
    };
  }, [typedJobs]);

  const paidToEmployeesCzk = useMemo(() => {
    const rows = Array.isArray(dashboardDailyReports)
      ? (dashboardDailyReports as DailyWorkReportMoney[])
      : [];
    return sumMoneyForApprovedDailyReports(rows);
  }, [dashboardDailyReports]);

  const unreadEmployeeChatCount = useMemo(() => {
    const rows = Array.isArray(dashboardChatMessages)
      ? dashboardChatMessages
      : [];
    return rows.filter(
      (m: { senderRole?: string; read?: boolean }) =>
        m.senderRole === "employee" && m.read !== true
    ).length;
  }, [dashboardChatMessages]);

  /** Rozpočty zakázek (bez / s DPH); zaplaceno z účetních příjmů; náklady = schválené výplaty; zisk = hrubé rozpočty minus mzdy (zjednodušený model). */
  const totalIncomeFromJobsNetCzk = jobsAggregate.totalBudgetNetKc;
  const totalIncomeFromJobsGrossCzk = jobsAggregate.totalBudgetGrossKc;
  const totalPaidFromJobsGrossCzk = jobsAggregate.totalPaidGrossKc;
  const totalRemainingToPayGrossCzk = roundMoney2(
    totalIncomeFromJobsGrossCzk - totalPaidFromJobsGrossCzk
  );
  const totalLaborCostsCzk = paidToEmployeesCzk;
  const profitCzk = totalIncomeFromJobsGrossCzk - totalLaborCostsCzk;

  const [importLeadsRows, setImportLeadsRows] = useState<LeadImportRow[]>([]);
  const [importLeadsLoading, setImportLeadsLoading] = useState(false);
  const [importLeadsError, setImportLeadsError] = useState<string | null>(null);

  const loadImportLeadsForDashboard = useCallback(async () => {
    if (!companyId || !user) return;
    setImportLeadsLoading(true);
    setImportLeadsError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/import-leads?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      type ImportLeadsApiBody = {
        ok?: boolean;
        rows?: LeadImportRow[];
        error?: string;
      };
      let data: ImportLeadsApiBody | null = null;
      try {
        data = (await res.json()) as ImportLeadsApiBody;
      } catch {
        data = null;
      }
      if (!res.ok) {
        setImportLeadsError(
          data?.error ?? `Chyba při načtení poptávek (HTTP ${res.status}).`
        );
        setImportLeadsRows([]);
        return;
      }
      if (data?.ok === true && Array.isArray(data.rows)) {
        setImportLeadsRows(data.rows);
      } else {
        setImportLeadsRows([]);
      }
    } catch {
      setImportLeadsError("Nelze načíst poptávky.");
      setImportLeadsRows([]);
    } finally {
      setImportLeadsLoading(false);
    }
  }, [companyId, user]);

  useEffect(() => {
    if (!showAdminDashboard || !companyId || !user) return;
    void loadImportLeadsForDashboard();
  }, [showAdminDashboard, companyId, user, loadImportLeadsForDashboard]);

  useEffect(() => {
    if (!showAdminDashboard || !companyId || !user) return;
    const t = window.setInterval(
      () => void loadImportLeadsForDashboard(),
      DASHBOARD_LEADS_POLL_MS
    );
    return () => window.clearInterval(t);
  }, [showAdminDashboard, companyId, user, loadImportLeadsForDashboard]);

  const importLeadOverlayByKey = useMemo(() => {
    const m = new Map<string, { receivedAt?: unknown }>();
    const list = Array.isArray(importLeadOverlaysRaw) ? importLeadOverlaysRaw : [];
    for (const doc of list) {
      const row = doc as { id?: string; receivedAt?: unknown };
      if (typeof row.id === "string" && row.id) m.set(row.id, row);
    }
    return m;
  }, [importLeadOverlaysRaw]);

  const leadsValueStats = useMemo(
    () => sumOrientacniCenyFromLeadRows(importLeadsRows),
    [importLeadsRows]
  );

  const latestFiveDashboardLeads = useMemo(() => {
    if (!importLeadsRows.length) return [];
    const list = [...importLeadsRows];
    list.sort((a, b) => {
      const ka = stableImportLeadDocumentId(a);
      const kb = stableImportLeadDocumentId(b);
      const ta = leadNewestTimestampMs(a, importLeadOverlayByKey.get(ka));
      const tb = leadNewestTimestampMs(b, importLeadOverlayByKey.get(kb));
      return tb - ta;
    });
    return list.slice(0, 5);
  }, [importLeadsRows, importLeadOverlayByKey]);

  useEffect(() => {
    if (!showAdminDashboard || !companyId) return;
    console.log("Loading dashboard data");
  }, [showAdminDashboard, companyId]);

  useEffect(() => {
    if (!showAdminDashboard || isJobsLoading) return;
    console.log("Jobs loaded");
  }, [showAdminDashboard, isJobsLoading]);

  useEffect(() => {
    if (!showAdminDashboard || dailyReportsLoading || isJobsLoading) return;
    console.log("Finance calculated");
  }, [
    showAdminDashboard,
    dailyReportsLoading,
    isJobsLoading,
    paidToEmployeesCzk,
    jobsAggregate.totalBudgetGrossKc,
  ]);

  useEffect(() => {
    if (!showAdminDashboard || chatDashboardLoading) return;
    console.log("Unread messages count", unreadEmployeeChatCount);
  }, [showAdminDashboard, chatDashboardLoading, unreadEmployeeChatCount]);

  if (isUserLoading || profileOrCompanyLoading) {
    return (
      <div
        className="flex min-h-[320px] items-center justify-center"
        role="status"
        aria-label="Načítání přehledu"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
        Přesměrování na přihlášení…
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chybí přiřazení k firmě</AlertTitle>
        <AlertDescription>
          V profilu není nastavené <code className="text-xs">companyId</code>. Kontaktujte administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  if (companyDocMissing) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Firma neexistuje</AlertTitle>
        <AlertDescription>
          Dokument firmy v databázi nebyl nalezen. Kontaktujte administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  if (companyLoadError) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Firmu nelze načíst</AlertTitle>
        <AlertDescription>{companyLoadError.message}</AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba načtení profilu</AlertTitle>
        <AlertDescription>
          {profileError.message}
          <span className="mt-2 block text-xs">
            Zkuste obnovit stránku nebo se odhlásit a znovu přihlásit.
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  if (!typedProfile) {
    return (
      <div className="max-w-2xl space-y-6">
        <h1 className="portal-page-title text-2xl">Přehled</h1>
        <Alert className="border-slate-200 bg-slate-50">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pracovní prostor se připravuje</AlertTitle>
          <AlertDescription>
            Váš profil nebo firma ještě nejsou v databázi. Měly by se vytvořit
            automaticky. Počkejte chvíli a obnovte stránku, nebo se odhlaste a
            přihlaste znovu.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="portal-section-label text-sm font-medium">
                Tým
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">—</div>
              <p className="portal-kpi-label">
                Zatím nejsou k dispozici žádná data
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="portal-section-label text-sm font-medium">
                Zakázky
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">—</div>
              <p className="portal-kpi-label">
                Zatím nejsou k dispozici žádná data
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="portal-page-title truncate text-2xl sm:text-3xl">
            Dobré ráno, {typedProfile.displayName || user?.email?.split("@")[0]}
          </h1>
          <p className="portal-page-description">
            {isCustomer
              ? "Vítejte ve svém klientském portálu."
              : `Zde je přehled vaší práce v ${companyName || companyId || "vaší organizaci"}.`}
          </p>
          <p className="mt-2 text-xs text-slate-800">
            Platforma {PLATFORM_NAME}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 sm:gap-3">
          {!isCustomer && (
            <Link href="/portal/labor/dochazka" className="min-w-[44px]">
              <Button
                variant="outlineLight"
                className="min-h-[44px] w-full gap-2 sm:w-auto"
              >
                <Clock className="h-4 w-4 shrink-0" />
                <span className="sm:inline">Moje docházka</span>
              </Button>
            </Link>
          )}

          {isManagement && (
            <Link href="/portal/jobs" className="min-w-[44px]">
              <Button className="min-h-[44px] w-full gap-2 sm:w-auto">
                <Briefcase className="h-4 w-4 shrink-0" />
                <span className="sm:inline">Nová zakázka</span>
              </Button>
            </Link>
          )}
        </div>
      </div>

      {!isCustomer && companyId && !showAdminDashboard ? (
        <DashboardOpenTasks
          companyId={companyId}
          employeeId={typedProfile?.employeeId}
          isPrivileged={isManagement || isAccountant}
        />
      ) : null}

      {showAdminDashboard ? (
        <div className="space-y-6">
          {companyId ? (
            <DashboardJobTasksWidget
              companyId={companyId}
              todayIso={todayIso}
              jobs={typedJobs}
              jobsLoading={isJobsLoading}
            />
          ) : null}

          {!chatDashboardLoading && unreadEmployeeChatCount > 0 ? (
            <Link
              href="/portal/chat"
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            >
              <Alert className="border-2 border-red-600 bg-red-50 text-red-950 shadow-md dark:border-red-500 dark:bg-red-950/40 dark:text-red-50">
                <MessageSquare className="h-5 w-5 text-red-600 dark:text-red-400" />
                <AlertTitle className="text-base font-semibold">
                  Nepřečtené zprávy od zaměstnanců
                </AlertTitle>
                <AlertDescription className="text-sm font-medium text-red-900 dark:text-red-100">
                  Máte {unreadEmployeeChatCount}{" "}
                  {unreadEmployeeChatCount === 1
                    ? "nepřečtenou zprávu"
                    : unreadEmployeeChatCount < 5
                      ? "nepřečtené zprávy"
                      : "nepřečtených zpráv"}
                  . Klepnutím otevřete firemní chat.
                </AlertDescription>
              </Alert>
            </Link>
          ) : null}

          {pendingDocuments.length > 0 ? (
            <Card className="border-amber-300 bg-amber-50/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-5 w-5 text-amber-700" />
                  Doklady k zařazení
                </CardTitle>
                <CardDescription>
                  {pendingDocuments.length} dokladů čeká na přiřazení.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingDocuments.slice(0, 5).map((d) => (
                  <div key={d.id} className="rounded border border-amber-200 bg-white/80 p-2 text-sm">
                    <div className="font-medium truncate">{d.fileName || d.id}</div>
                    <div className="text-xs text-muted-foreground">
                      {(d.uploadedByName || "Neznámý uživatel").toString()} ·{" "}
                      {(d.fileType || "soubor").toString()}
                    </div>
                  </div>
                ))}
                <Link href="/portal/documents">
                  <Button variant="secondary" className="min-h-[40px]">
                    Otevřít a zařadit doklady
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {companyId ? (
            <DashboardDocumentsToPayWidget companyId={companyId} todayIso={todayIso} />
          ) : null}

          {companyId ? (
            <div className="mx-auto w-full max-w-xl">
              <DashboardTerminalActiveWidget
                employees={employees as Record<string, unknown>[] | undefined}
                attendanceTodayRows={attendanceTodayRows as AttendanceRow[]}
                openWorkSegmentRows={openWorkSegmentsRaw ?? []}
                loading={attendanceTodayLoading || openWorkSegmentsLoading}
              />
            </div>
          ) : null}

          {companyId ? <CompanyScheduleCalendar companyId={companyId} /> : null}

          {companyId ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-6">
              <Link
                href="/portal/leads"
                className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
              >
                <Card className="h-full border-2 border-black bg-white text-black shadow-sm transition-shadow hover:shadow-md">
                  <CardHeader className="space-y-1 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base font-semibold text-black">
                      <Inbox className="h-5 w-5 shrink-0" aria-hidden />
                      Poptávky aktuálně v hodnotě
                    </CardTitle>
                    <CardDescription className="text-sm text-black/75">
                      Součet orientačních cen z importovaných poptávek vaší firmy (řádky s platnou
                      vyplněnou cenou).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {importLeadsLoading ? (
                      <div className="flex min-h-[4.5rem] items-center">
                        <span className="inline-block h-9 w-9 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      </div>
                    ) : importLeadsError ? (
                      <p className="text-sm text-destructive">{importLeadsError}</p>
                    ) : (
                      <>
                        <p className="text-3xl font-bold tabular-nums tracking-tight text-black sm:text-4xl">
                          {formatKc(leadsValueStats.totalKc)}
                        </p>
                        <p className="text-sm leading-snug text-black/85">
                          {leadsValueStats.totalCount === 0
                            ? "V importu zatím nejsou žádné poptávky."
                            : `Orientační cenu má vyplněnou ${leadsValueStats.withPriceCount} z ${leadsValueStats.totalCount} poptávek.`}
                        </p>
                        <p className="text-xs text-black/70">
                          Klepnutím otevřete sekci Poptávky — hodnota se přepočítá při načtení importu
                          (cca každou minutu) a při změnách v přehledu poptávek.
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </Link>

              <Card
                className={cn(
                  "flex h-full min-h-0 flex-col border border-emerald-200/70 bg-emerald-50/35 shadow-sm dark:border-emerald-900/45 dark:bg-emerald-950/20"
                )}
              >
                <CardHeader className="space-y-0.5 pb-2 pt-4">
                  <CardTitle className="flex items-center gap-2 text-base font-semibold text-emerald-950 dark:text-emerald-100">
                    <Inbox className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    Nejnovější poptávky
                  </CardTitle>
                  <CardDescription className="text-xs text-emerald-900/75 dark:text-emerald-200/80">
                    Posledních 5 podle data (import nebo přijetí v aplikaci). Aktualizace z API a z
                    Firestore.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-2 pb-4 pt-0">
                  {importLeadsLoading && importLeadsRows.length === 0 ? (
                    <div className="flex min-h-[6rem] items-center justify-center">
                      <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-emerald-600/50 border-t-transparent" />
                    </div>
                  ) : importLeadsError && importLeadsRows.length === 0 ? (
                    <p className="text-sm text-destructive">{importLeadsError}</p>
                  ) : latestFiveDashboardLeads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Zatím žádné poptávky k zobrazení. Zkontrolujte import v nastavení firmy.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {latestFiveDashboardLeads.map((r) => {
                        const key = stableImportLeadDocumentId(r);
                        const ts = leadNewestTimestampMs(r, importLeadOverlayByKey.get(key));
                        const contact =
                          [r.telefon?.trim(), r.email?.trim()].filter(Boolean).join(" · ") || "—";
                        const msg = String(r.zprava ?? "").trim();
                        return (
                          <li key={key}>
                            <Link
                              href={`/portal/leads?openLead=${encodeURIComponent(key)}`}
                              className={cn(
                                "flex min-h-[48px] gap-2 rounded-md border border-emerald-200/60 bg-white/70 px-2.5 py-2 text-left transition-colors hover:bg-emerald-50/90 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/35",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                              )}
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                                    <span className="truncate text-sm font-semibold text-foreground">
                                      {r.jmeno?.trim() || "—"}
                                    </span>
                                    <InquiryTypeBadge
                                      type={r.typ}
                                      variant="preview"
                                      className="max-w-[9rem] text-[10px] font-normal leading-none"
                                    />
                                  </span>
                                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                    {formatLeadListDate(ts)}
                                  </span>
                                </div>
                                <p className="truncate text-xs text-muted-foreground">{contact}</p>
                                <p className="line-clamp-1 text-xs text-foreground/85" title={msg}>
                                  {msg || "—"}
                                </p>
                              </div>
                              <ArrowRight
                                className="h-4 w-4 shrink-0 self-center text-emerald-600 opacity-70 dark:text-emerald-400"
                                aria-hidden
                              />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link
                    href="/portal/leads"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    Všechny poptávky
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium leading-none">Zakázky</CardTitle>
                <Briefcase className="h-4 w-4 shrink-0 text-primary" />
              </CardHeader>
              <CardContent className="space-y-1">
                {jobsError ? (
                  <p className="text-sm text-destructive">Chyba načtení zakázek</p>
                ) : (
                  <>
                    <div className="portal-kpi-value text-2xl sm:text-3xl">
                      {isJobsLoading ? (
                        <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle" />
                      ) : (
                        jobsAggregate.count
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Počet zakázek ve firmě</p>
                    <div className="pt-2 space-y-0.5 text-sm">
                      <div className="flex justify-between gap-2 tabular-nums">
                        <span className="text-muted-foreground">Bez DPH</span>
                        <span className="font-semibold text-foreground">
                          {isJobsLoading ? "…" : formatKc(jobsAggregate.totalBudgetNetKc)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 tabular-nums text-base font-bold text-foreground">
                        <span className="font-normal text-muted-foreground text-sm">S DPH</span>
                        <span>
                          {isJobsLoading ? "…" : formatKc(jobsAggregate.totalBudgetGrossKc)}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Součet rozpočtů zakázek</p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium leading-none">
                  Vyplaceno zaměstnancům
                </CardTitle>
                <Banknote className="h-4 w-4 shrink-0 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl sm:text-3xl">
                  {dailyReportsLoading ? (
                    <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent align-middle" />
                  ) : (
                    formatKc(paidToEmployeesCzk)
                  )}
                </div>
                <p className="portal-kpi-label mt-1">
                  Součet schválených výkazů (payableAmountCzk)
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card shadow-sm transition-shadow hover:shadow-md sm:col-span-2 xl:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium leading-none">Finance</CardTitle>
                <PieChart className="h-4 w-4 shrink-0 text-primary" />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    Celkové příjmy (zaplacené, s DPH)
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {isJobsLoading ? "…" : formatKc(totalPaidFromJobsGrossCzk)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    Hodnota zakázek (rozpočty s DPH)
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {isJobsLoading ? "…" : formatKc(totalIncomeFromJobsGrossCzk)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Zbývá doplatit (s DPH)</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      totalRemainingToPayGrossCzk < 0
                        ? "text-destructive"
                        : "text-foreground"
                    }`}
                  >
                    {isJobsLoading ? "…" : formatKc(totalRemainingToPayGrossCzk)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-muted-foreground">Rozpočty bez DPH (součet)</span>
                  <span className="font-semibold tabular-nums">
                    {isJobsLoading ? "…" : formatKc(totalIncomeFromJobsNetCzk)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Náklady (mzdy)</span>
                  <span className="font-semibold tabular-nums">
                    {dailyReportsLoading ? "…" : formatKc(totalLaborCostsCzk)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-t pt-3">
                  <span className="font-medium">Zisk (odhad)</span>
                  <span
                    className={`font-bold tabular-nums ${
                      profitCzk >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {isJobsLoading || dailyReportsLoading
                      ? "…"
                      : formatKc(profitCzk)}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Zisk = součet rozpočtů zakázek s DPH minus schválené částky z výkazů. Nezahrnuje ostatní náklady.
                </p>
              </CardContent>
            </Card>

            <Link
              href="/portal/chat"
              className="block min-h-[44px] rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card
                className={`h-full shadow-sm transition-shadow hover:shadow-md ${
                  !chatDashboardLoading && unreadEmployeeChatCount > 0
                    ? "border-2 border-red-600 bg-red-50/90 dark:border-red-500 dark:bg-red-950/30"
                    : "border-border bg-card"
                }`}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium leading-none">Zprávy</CardTitle>
                  <MessageSquare
                    className={`h-4 w-4 shrink-0 ${
                      !chatDashboardLoading && unreadEmployeeChatCount > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-primary"
                    }`}
                  />
                </CardHeader>
                <CardContent>
                  {chatDashboardLoading ? (
                    <div className="flex h-12 items-center">
                      <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : (
                    <>
                      <p
                        className={`text-lg font-semibold ${
                          unreadEmployeeChatCount > 0
                            ? "text-red-700 dark:text-red-200"
                            : "text-foreground"
                        }`}
                      >
                        {unreadEmployeeChatCount === 0
                          ? "Žádné nové"
                          : `${unreadEmployeeChatCount} nepřečtených`}
                      </p>
                      <p className="portal-kpi-label mt-1">Od zaměstnanců — klepněte pro chat</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {isManagement && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="portal-section-label text-sm font-medium">Tým</CardTitle>
                  <Users className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="portal-kpi-value">{employees.length || 0}</div>
                  <p className="portal-kpi-label">Celkový počet pracovníků</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="portal-section-label text-sm font-medium">
                  Aktivní zakázky
                </CardTitle>
                <Briefcase className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value">
                  {jobs.filter((job) => job.status !== "dokončená").length || 0}
                </div>
                <p className="portal-kpi-label">Probíhající projekty</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="portal-section-label text-sm font-medium">
                  Docházka dnes
                </CardTitle>
                <Clock className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value">{attendanceTodayCount}</div>
                <p className="portal-kpi-label">
                  {attendanceTodayCount === 0
                    ? "Zatím nejsou záznamy docházky"
                    : "Záznamy docházky za dnešek"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="portal-section-label text-sm font-medium">
                  Měsíční obrat
                </CardTitle>
                <Wallet className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value">
                  {monthlyRevenueCzk.toLocaleString("cs-CZ")} Kč
                </div>
                <p className="portal-kpi-label">
                  {monthlyRevenueCzk === 0
                    ? "Zatím nejsou k dispozici žádná data"
                    : "Součet příjmů v aktuálním měsíci z dokladů"}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
          {isManagement && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="portal-section-label text-sm font-medium">
                  Tým
                </CardTitle>
                <Users className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value">{employees.length || 0}</div>
                <p className="portal-kpi-label">Celkový počet pracovníků</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="portal-section-label text-sm font-medium">
                {isCustomer ? "Moje Zakázky" : "Aktivní zakázky"}
              </CardTitle>
              <Briefcase className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="portal-kpi-value">
                {jobs.filter((job) => job.status !== "dokončená").length || 0}
              </div>
              <p className="portal-kpi-label">Probíhající projekty</p>
            </CardContent>
          </Card>

          {!isCustomer && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="portal-section-label text-sm font-medium">
                    Docházka dnes
                  </CardTitle>
                  <Clock className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="portal-kpi-value">{attendanceTodayCount}</div>
                  <p className="portal-kpi-label">
                    {attendanceTodayCount === 0
                      ? "Zatím nejsou záznamy docházky"
                      : "Záznamy docházky za dnešek"}
                  </p>
                </CardContent>
              </Card>

              {(isManagement || isAccountant) && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="portal-section-label text-sm font-medium">
                      Měsíční obrat
                    </CardTitle>
                    <Wallet className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="portal-kpi-value">
                      {monthlyRevenueCzk.toLocaleString("cs-CZ")} Kč
                    </div>
                    <p className="portal-kpi-label">
                      {monthlyRevenueCzk === 0
                        ? "Zatím nejsou k dispozici žádná data"
                        : "Součet příjmů v aktuálním měsíci z dokladů"}
                    </p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-6 lg:gap-8 ${
          showAdminDashboard ? "" : "lg:grid-cols-3"
        }`}
      >
        {!showAdminDashboard ? (
          <div className="min-w-0 space-y-6 lg:col-span-2 lg:space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>
                  {isCustomer ? "Stav mých projektů" : "Sledované projekty"}
                </CardTitle>
                <CardDescription>
                  Aktuální stav rozpracování zakázek
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6">
                {jobsError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Zakázky se nepodařilo načíst: {jobsError.message}
                    </AlertDescription>
                  </Alert>
                )}

                {isJobsLoading && jobsQuery ? (
                  <div className="flex justify-center p-8">
                    <div
                      className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
                      aria-hidden
                    />
                  </div>
                ) : jobs.length > 0 ? (
                  jobs.slice(0, 5).map((job) => (
                    <div
                      key={job.id}
                      className="space-y-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">
                            {job.name || "Bez názvu"}
                          </span>
                          <span className="text-[10px] font-medium uppercase text-slate-800">
                            {job.status || "neuvedeno"}
                          </span>
                        </div>

                        <Link href={`/portal/jobs/${job.id}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-slate-700"
                          >
                            Detail <ArrowRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-slate-800">
                    Zatím nemáte žádné zakázky.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}

        <div
          className={`min-w-0 space-y-6 lg:space-y-8 ${
            showAdminDashboard ? "max-w-md lg:max-w-none" : ""
          }`}
        >
          {!isCustomer && (
            <Card>
              <CardHeader>
                <CardTitle>Rychlé akce</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Link href="/portal/labor/dochazka">
                  <Button
                    variant="outlineLight"
                    className="min-h-[44px] w-full justify-start"
                  >
                    Zapsat příchod/odchod
                  </Button>
                </Link>

                {(isManagement || isAccountant) && (
                  <Link href="/portal/invoices/new">
                    <Button
                      variant="outlineLight"
                      className="min-h-[44px] w-full justify-start"
                    >
                      Vytvořit fakturu
                    </Button>
                  </Link>
                )}

                <Link href="/portal/chat">
                  <Button
                    variant="outlineLight"
                    className="min-h-[44px] w-full justify-start"
                  >
                    Zprávy týmu
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle>Poslední aktivita</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Zatím nejsou k dispozici žádná data.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}