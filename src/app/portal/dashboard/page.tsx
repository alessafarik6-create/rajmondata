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
  CalendarClock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useUser,
  useFirestore,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import { collection, query, orderBy, limit, where, doc, updateDoc, serverTimestamp } from "firebase/firestore";
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
  documentJobLinkId,
  type CompanyDocumentAssignmentLike,
} from "@/lib/company-document-assignment";
import {
  formatKc,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
} from "@/lib/employee-money";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";
import { CompanyScheduleCalendar } from "@/components/portal/company-schedule-calendar";
import { PortalDashboardCompactGrid } from "@/components/portal/portal-dashboard-compact-grid";
import type { DashboardActivityRow } from "@/components/portal/dashboard-activity-section";
import { DashboardUnassignedMeasurementPhotos } from "@/components/portal/dashboard-unassigned-measurement-photos";
import {
  isCustomerActivityUnresolved,
  sortCustomerActivitiesByNewest,
} from "@/lib/customer-activity";
import { isEmployeeActivityUnresolved } from "@/lib/employee-activity";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import type { AttendanceRow } from "@/lib/employee-attendance";
import {
  formatPortfolioMillionsKc,
  type LeadPortfolioStats,
} from "@/lib/lead-portfolio-value";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { InquiryTypeBadge } from "@/components/inquiry-type-badge";
import {
  resolveInquiryTypeRaw,
  type InquiryTypeOverlayFields,
} from "@/lib/inquiry-type-badge";
import { cn } from "@/lib/utils";
import { MeetingRecordFormDialog } from "@/components/meeting-records/meeting-record-form-dialog";
import type { ActivityActorProfile } from "@/lib/activity-log";
import { useMergedPlatformModuleCatalog } from "@/contexts/platform-module-catalog-context";
import { MobileDashboard } from "@/components/portal/mobile-dashboard/MobileDashboard";
import { MobileBottomNav } from "@/components/portal/mobile-dashboard/MobileBottomNav";
import { MobileSchedulePreviewCard } from "@/components/portal/mobile-dashboard/MobileSchedulePreviewCard";
import { useIsBelowLg, useIsMobile } from "@/hooks/use-mobile";
import { useInstallationCalendarBadgeCount } from "@/hooks/use-installation-calendar-badge-count";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DASHBOARD_LEADS_POLL_MS = 60_000;

function formatPlatformGraceRemaining(iso: string | null | undefined, _tick = 0): string {
  if (!iso) return "—";
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return "—";
  const ms = Math.max(0, end - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min`;
}

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
  globalRoles?: string[];
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
  const [meetingRecordOpen, setMeetingRecordOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const platformCatalog = useMergedPlatformModuleCatalog();

  const {
    userProfile: profile,
    profileLoading: isProfileLoading,
    profileError,
    companyId: companyIdFromProfile,
    company,
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

  useEffect(() => {
    if (isProfileLoading) return;
    if (isCustomer) {
      router.replace("/portal/customer");
    }
  }, [isProfileLoading, isCustomer, router]);

  /** Přehledové KPI (zakázky, mzdy, finance, zprávy) — vedení a účetní. */
  const showAdminDashboard =
    (isManagement || isAccountant) && !isCustomer;

  const { count: installationCalendarBadge } = useInstallationCalendarBadgeCount({
    companyId,
    employeeId: typedProfile?.employeeId,
    isPrivileged: isManagement || isAccountant,
  });

  const belowLg = useIsBelowLg();
  const isPhoneLayout = useIsMobile();

  const schedulePreviewSlot =
    companyId && !isCustomer && belowLg ? (
      <MobileSchedulePreviewCard
        companyId={companyId}
        onOpenCalendar={() => setScheduleModalOpen(true)}
      />
    ) : null;

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

  const customersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return collection(firestore, "companies", companyId, "customers");
  }, [firestore, companyId, showAdminDashboard]);

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
  const customerActivitiesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "customer_activities"),
      orderBy("createdAt", "desc"),
      limit(300)
    );
  }, [firestore, companyId, showAdminDashboard]);

  const employeeActivitiesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "employee_activities"),
      orderBy("createdAt", "desc"),
      limit(300)
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
  const { data: customersRaw } = useCollection(customersQuery);
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
  const { data: customerActivitiesRaw } = useCollection(customerActivitiesQuery);
  const { data: employeeActivitiesRaw } = useCollection(employeeActivitiesQuery);

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
      isFinancialCompanyDocument(r as CompanyDocumentLike) &&
      !documentJobLinkId(r as CompanyDocumentAssignmentLike)
    );
    const toMs = (t: unknown) => {
      if (t && typeof (t as { toMillis?: () => number }).toMillis === "function") {
        return (t as { toMillis: () => number }).toMillis();
      }
      if (t && typeof (t as Record<string, unknown>)["seconds"] === "number") {
        return Number((t as Record<string, unknown>)["seconds"]) * 1000;
      }
      return 0;
    };
    return [...financial].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [pendingDocumentsRaw]);
  type ActivityRow = {
    id: string;
    title?: string;
    message?: string;
    createdAt?: unknown;
    timestamp?: unknown;
    sentAt?: unknown;
    updatedAt?: unknown;
    targetLink?: string;
    resolved?: boolean;
  };

  const customerActivitiesUnresolved = useMemo(() => {
    const rows = (customerActivitiesRaw ?? []) as ActivityRow[];
    return sortCustomerActivitiesByNewest(
      rows.filter((a) => isCustomerActivityUnresolved(a))
    );
  }, [customerActivitiesRaw]);

  const employeeActivitiesUnresolved = useMemo(() => {
    const rows = (employeeActivitiesRaw ?? []) as ActivityRow[];
    return rows.filter((a) => isEmployeeActivityUnresolved(a));
  }, [employeeActivitiesRaw]);

  const markCustomerActivityResolved = useCallback(
    async (activityId: string) => {
      if (!firestore || !companyId || !user?.uid) return;
      setResolvingCustomerActivityId(activityId);
      try {
        await updateDoc(
          doc(firestore, "companies", companyId, "customer_activities", activityId),
          {
            resolved: true,
            resolvedAt: serverTimestamp(),
            resolvedBy: user.uid,
          }
        );
      } finally {
        setResolvingCustomerActivityId(null);
      }
    },
    [firestore, companyId, user?.uid]
  );

  const markEmployeeActivityResolved = useCallback(
    async (activityId: string) => {
      if (!firestore || !companyId || !user?.uid) return;
      setResolvingEmployeeActivityId(activityId);
      try {
        await updateDoc(
          doc(firestore, "companies", companyId, "employee_activities", activityId),
          {
            resolved: true,
            resolvedAt: serverTimestamp(),
            resolvedBy: user.uid,
          }
        );
      } finally {
        setResolvingEmployeeActivityId(null);
      }
    },
    [firestore, companyId, user?.uid]
  );

  const typedJobs: JobData[] = Array.isArray(allJobsRaw)
    ? (allJobsRaw as JobData[])
    : [];

  const customersById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    const list = Array.isArray(customersRaw) ? customersRaw : [];
    for (const c of list) {
      const id = String((c as { id?: string }).id ?? "").trim();
      if (id) map.set(id, c as Record<string, unknown>);
    }
    return map;
  }, [customersRaw]);

  const jobsForContractedOverview = useMemo(
    () =>
      typedJobs
        .filter((j) => j.id)
        .map((j) => ({ ...(j as unknown as Record<string, unknown>), id: j.id })),
    [typedJobs]
  );

  // Úkoly na mobilním dashboardu nezobrazujeme automaticky (otevřou se přes modul „Úkoly“).

  const jobNamesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const j of typedJobs) {
      if (j.id) m[j.id] = j.name?.trim() || j.id;
    }
    return m;
  }, [typedJobs]);

  const jobsForAssign = useMemo(
    () =>
      typedJobs
        .filter((j) => j.id)
        .map((j) => ({ id: j.id, name: j.name?.trim() || j.id })),
    [typedJobs]
  );

  const canOpenMeetingRecordForm =
    showAdminDashboard &&
    (isManagement ||
      (Array.isArray(typedProfile?.globalRoles) &&
        typedProfile.globalRoles.includes("super_admin")));

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
  const [leadPortfolioStats, setLeadPortfolioStats] = useState<LeadPortfolioStats | null>(
    null
  );
  const [leadPortfolioLoading, setLeadPortfolioLoading] = useState(false);
  const [customerActivitiesExpanded, setCustomerActivitiesExpanded] = useState(false);
  const [employeeActivitiesExpanded, setEmployeeActivitiesExpanded] = useState(false);
  const [resolvingCustomerActivityId, setResolvingCustomerActivityId] = useState<string | null>(
    null
  );
  const [resolvingEmployeeActivityId, setResolvingEmployeeActivityId] = useState<string | null>(
    null
  );

  const canSeePlatformOperatorInvoices =
    role === "owner" || role === "admin" || role === "accountant";
  const [platformInvoiceUnpaid, setPlatformInvoiceUnpaid] = useState(0);
  const [platformInvoiceOverdue, setPlatformInvoiceOverdue] = useState(0);
  const [platformBilling, setPlatformBilling] = useState<{
    hasUnpaidEffective?: boolean;
    paymentClaimActive?: boolean;
    gracePeriodUntilIso?: string | null;
    graceMsRemaining?: number;
    accountSuspendedForPayment?: boolean;
  } | null>(null);
  const [platformGraceTick, setPlatformGraceTick] = useState(0);
  useEffect(() => {
    if (!platformBilling?.paymentClaimActive) return;
    const t = window.setInterval(() => setPlatformGraceTick((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [platformBilling?.paymentClaimActive]);

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

  const loadLeadPortfolioForDashboard = useCallback(async () => {
    if (!companyId || !user) return;
    setLeadPortfolioLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/leads/portfolio-value?companyId=${encodeURIComponent(companyId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        stats?: LeadPortfolioStats;
      };
      if (res.ok && data.ok && data.stats) {
        setLeadPortfolioStats(data.stats);
      }
    } catch {
      setLeadPortfolioStats(null);
    } finally {
      setLeadPortfolioLoading(false);
    }
  }, [companyId, user]);

  useEffect(() => {
    if (!showAdminDashboard || !companyId || !user) return;
    void loadImportLeadsForDashboard();
    void loadLeadPortfolioForDashboard();
  }, [showAdminDashboard, companyId, user, loadImportLeadsForDashboard, loadLeadPortfolioForDashboard]);

  useEffect(() => {
    if (!showAdminDashboard || !companyId || !user) return;
    const t = window.setInterval(() => {
      void loadImportLeadsForDashboard();
      void loadLeadPortfolioForDashboard();
    }, DASHBOARD_LEADS_POLL_MS);
    return () => window.clearInterval(t);
  }, [
    showAdminDashboard,
    companyId,
    user,
    loadImportLeadsForDashboard,
    loadLeadPortfolioForDashboard,
  ]);

  useEffect(() => {
    if (!companyId || !user || !canSeePlatformOperatorInvoices) {
      setPlatformInvoiceUnpaid(0);
      setPlatformInvoiceOverdue(0);
      setPlatformBilling(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/company/platform-invoices", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => ({}))) as {
          unpaidCount?: number;
          overdueCount?: number;
          billing?: Record<string, unknown>;
        };
        if (cancelled) return;
        setPlatformInvoiceUnpaid(Number(data.unpaidCount) || 0);
        setPlatformInvoiceOverdue(Number(data.overdueCount) || 0);
        const b = data.billing;
        setPlatformBilling(
          b && typeof b === "object"
            ? {
                hasUnpaidEffective: Boolean(b.hasUnpaidEffective),
                paymentClaimActive: Boolean(b.paymentClaimActive),
                gracePeriodUntilIso:
                  typeof b.gracePeriodUntilIso === "string" ? b.gracePeriodUntilIso : null,
                graceMsRemaining: Number(b.graceMsRemaining) || 0,
                accountSuspendedForPayment: Boolean(b.accountSuspendedForPayment),
              }
            : null
        );
      } catch {
        if (!cancelled) {
          setPlatformInvoiceUnpaid(0);
          setPlatformInvoiceOverdue(0);
          setPlatformBilling(null);
        }
      }
    };
    void load();
    const iv = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [companyId, user, canSeePlatformOperatorInvoices]);

  const importLeadOverlayByKey = useMemo(() => {
    const m = new Map<string, { receivedAt?: unknown }>();
    const list = Array.isArray(importLeadOverlaysRaw) ? importLeadOverlaysRaw : [];
    for (const doc of list) {
      const row = doc as { id?: string; receivedAt?: unknown };
      if (typeof row.id === "string" && row.id) m.set(row.id, row);
    }
    return m;
  }, [importLeadOverlaysRaw]);

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
    <>
      <MobileDashboard
        displayName={String(typedProfile.displayName || user?.email?.split("@")[0] || "")}
        companyLabel={String(companyName || companyId || "Organizace")}
        role={role}
        company={(company as unknown) as import("@/lib/platform-access").CompanyPlatformFields}
        platformCatalog={platformCatalog}
        schedulePreview={schedulePreviewSlot}
        tasksSection={undefined}
        extraModuleBadgeCounts={
          installationCalendarBadge > 0 ? { calendar: installationCalendarBadge } : undefined
        }
        onOpenScheduleModal={
          companyId && !isCustomer && belowLg ? () => setScheduleModalOpen(true) : undefined
        }
        unreadMessages={unreadEmployeeChatCount}
        overduePlatformInvoices={platformInvoiceOverdue}
        unpaidPlatformInvoices={platformInvoiceUnpaid}
        companyId={companyId}
        showAdminDashboard={showAdminDashboard}
        todayIso={todayIso}
        jobsForTaskBadge={typedJobs}
        jobsLoading={isJobsLoading}
        employeeId={typedProfile?.employeeId}
        isTaskBadgePrivileged={isManagement || isAccountant}
        quickStats={{
          hoursLabel: "—",
          payrollLabel: "—",
          messagesLabel: unreadEmployeeChatCount ? String(unreadEmployeeChatCount) : "0",
          unpaidLabel: "—",
          jobsLabel: String(jobs.filter((j) => j.status !== "dokončená").length || 0),
        }}
        showContractedJobsOverview={showAdminDashboard}
        contractedJobs={jobsForContractedOverview}
        contractedJobsCustomersById={customersById}
      />
      <MobileBottomNav unreadMessages={unreadEmployeeChatCount} role={role} />

      {companyId && !isCustomer && belowLg ? (
        <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
          <DialogContent
            overlayClassName={isPhoneLayout ? "!z-[80]" : undefined}
            className={cn(
              "!border-white/10 !bg-slate-950 !p-0 !text-slate-50 !shadow-2xl !ring-white/10",
              "!flex max-h-[100dvh] flex-col gap-0 !overflow-hidden",
              "[&>button:last-child]:hidden",
              isPhoneLayout
                ? "!fixed !inset-0 !left-0 !top-0 z-[80] !h-[100dvh] !max-h-[100dvh] !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-none"
                : "!left-1/2 !top-1/2 !max-h-[min(92dvh,880px)] !w-[min(900px,calc(100vw-2rem))] !max-w-[min(900px,calc(100vw-2rem))] !-translate-x-1/2 !-translate-y-1/2 !rounded-2xl"
            )}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white">Kalendář — schůzky a montáže</p>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0 border-white/20 bg-white/5 px-4 text-slate-100 hover:bg-white/10"
                onClick={() => setScheduleModalOpen(false)}
              >
                Zavřít
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2 sm:px-4">
              {scheduleModalOpen ? (
                <CompanyScheduleCalendar
                  companyId={companyId}
                  layout="compact"
                  appearance="darkPortal"
                  readOnly={!showAdminDashboard}
                  restrictEmployeeEvents={isEmployee}
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <div className="hidden lg:block space-y-6 sm:space-y-8">
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

      {!isCustomer && canSeePlatformOperatorInvoices && companyId ? (
        platformBilling?.accountSuspendedForPayment ? (
          <Link
            href="/portal/vyuctovani"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <Alert className="border-2 border-red-700 bg-red-50 text-red-950 shadow-md dark:border-red-500 dark:bg-red-950/45 dark:text-red-50">
              <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-400" />
              <AlertTitle className="text-base font-semibold">Účet byl deaktivován</AlertTitle>
              <AlertDescription className="text-sm font-medium text-red-900 dark:text-red-100">
                Účet byl deaktivován kvůli nepotvrzené úhradě faktury. Kontaktujte provozovatele platformy nebo počkejte na ruční aktivaci.
              </AlertDescription>
            </Alert>
          </Link>
        ) : platformBilling?.paymentClaimActive ? (
          <Link
            href="/portal/vyuctovani"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            <Alert className="border-2 border-sky-600 bg-sky-50 text-sky-950 shadow-md dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-50">
              <CalendarClock className="h-5 w-5 text-sky-700 dark:text-sky-300" />
              <AlertTitle className="text-base font-semibold">Platba čeká na potvrzení</AlertTitle>
              <AlertDescription className="text-sm font-medium text-sky-900 dark:text-sky-100">
                Platba čeká na potvrzení superadministrátorem. Účet zůstává aktivní ještě 48 hodin od oznámení. Zbývá:{" "}
                {formatPlatformGraceRemaining(platformBilling.gracePeriodUntilIso, platformGraceTick)}.
              </AlertDescription>
            </Alert>
          </Link>
        ) : platformInvoiceOverdue > 0 ? (
          <Link
            href="/portal/vyuctovani"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
          >
            <Alert className="border-2 border-rose-600 bg-rose-50 text-rose-950 shadow-md dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-50">
              <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              <AlertTitle className="text-base font-semibold">Faktury po splatnosti</AlertTitle>
              <AlertDescription className="text-sm font-medium text-rose-900 dark:text-rose-100">
                Máte {platformInvoiceOverdue}{" "}
                {platformInvoiceOverdue === 1
                  ? "fakturu po splatnosti"
                  : platformInvoiceOverdue < 5
                    ? "faktury po splatnosti"
                    : "faktur po splatnosti"}{" "}
                od provozovatele platformy. Otevřete sekci Vyúčtování služeb a uhraďte je prosím co nejdříve.
              </AlertDescription>
            </Alert>
          </Link>
        ) : platformInvoiceUnpaid > 0 ? (
          <Link
            href="/portal/vyuctovani"
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
          >
            <Alert className="border-2 border-rose-600 bg-rose-50 text-rose-950 shadow-md dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-50">
              <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              <AlertTitle className="text-base font-semibold">Máte neuhrazenou fakturu za služby platformy</AlertTitle>
              <AlertDescription className="text-sm font-medium text-rose-900 dark:text-rose-100">
                Počet neuhrazených faktur: {platformInvoiceUnpaid}. V sekci Vyúčtování služeb najdete PDF, QR platbu a platební údaje.
              </AlertDescription>
            </Alert>
          </Link>
        ) : null
      ) : null}

      {!belowLg && !isCustomer && companyId && !showAdminDashboard ? (
        <DashboardOpenTasks
          companyId={companyId}
          employeeId={typedProfile?.employeeId}
          isPrivileged={isManagement || isAccountant}
        />
      ) : null}

      {showAdminDashboard ? (
        <div className="space-y-6">
          {companyId ? (
            <>
              <PortalDashboardCompactGrid
                companyId={companyId}
                todayIso={todayIso}
                jobs={jobs}
                allJobs={typedJobs}
                jobsLoading={isJobsLoading}
                importLeadsRows={importLeadsRows}
                importLeadsLoading={importLeadsLoading}
                latestLeads={latestFiveDashboardLeads}
                importLeadOverlayByKey={
                  importLeadOverlayByKey as Map<string, InquiryTypeOverlayFields>
                }
                employees={employees as Record<string, unknown>[] | undefined}
                attendanceTodayRows={attendanceTodayRows as AttendanceRow[]}
                openWorkSegmentRows={openWorkSegmentsRaw ?? []}
                attendanceLoading={attendanceTodayLoading || openWorkSegmentsLoading}
                customerActivities={customerActivitiesUnresolved as DashboardActivityRow[]}
                employeeActivities={employeeActivitiesUnresolved as DashboardActivityRow[]}
                unreadChatCount={unreadEmployeeChatCount}
                chatLoading={chatDashboardLoading}
                pendingDocumentsCount={pendingDocuments.length}
                fleetConnected={Boolean(
                  (company as { fleetIntegrationStatus?: string } | null)?.fleetIntegrationStatus ===
                    "configured"
                )}
                scheduleTodayCount={installationCalendarBadge}
                restrictScheduleForEmployee={isEmployee && !isManagement && !isAccountant}
              />
              <DashboardUnassignedMeasurementPhotos
                firestore={firestore}
                companyId={companyId}
                jobNamesById={jobNamesById}
                jobsForAssign={jobsForAssign}
                userId={user?.uid ?? null}
                profile={profile as { role?: string; globalRoles?: unknown } | null}
              />
            </>
          ) : null}
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

        {!showAdminDashboard ? (
        <div className="min-w-0 space-y-6 lg:space-y-8">
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

                {canOpenMeetingRecordForm && firestore && companyId && user ? (
                  <Button
                    type="button"
                    variant="outlineLight"
                    className="min-h-[44px] w-full justify-start gap-2"
                    onClick={() => setMeetingRecordOpen(true)}
                  >
                    <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                    Záznam ze schůzky
                  </Button>
                ) : null}

                {canOpenMeetingRecordForm ? (
                  <Button variant="outlineLight" className="min-h-[44px] w-full justify-start gap-2" asChild>
                    <Link href="/portal/meeting-records">
                      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
                      Evidence schůzek
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          )}

          {canOpenMeetingRecordForm && firestore && companyId && user ? (
            <MeetingRecordFormDialog
              open={meetingRecordOpen}
              onOpenChange={setMeetingRecordOpen}
              firestore={firestore}
              companyId={companyId}
              user={user}
              profile={typedProfile as ActivityActorProfile | null}
              jobs={jobsForAssign}
            />
          ) : null}

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
        ) : null}
      </div>
      </div>
    </>
  );
}