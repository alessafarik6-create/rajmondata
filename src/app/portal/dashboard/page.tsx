"use client";

import React, { useEffect, useMemo } from "react";
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
  Calendar,
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
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { parseFirestoreScheduledAt } from "@/lib/lead-meeting-utils";
import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/platform-brand";
import { useRouter } from "next/navigation";
import { parseBudgetKcFromJob } from "@/lib/work-contract-deposit";
import {
  formatKc,
  sumMoneyForApprovedDailyReports,
  type DailyWorkReportMoney,
} from "@/lib/employee-money";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";

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

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !isManagement) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId, isManagement]);

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

  const leadMeetingsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !showAdminDashboard) return null;
    return query(
      collection(firestore, "companies", companyId, "lead_meetings"),
      orderBy("scheduledAt", "asc"),
      limit(120)
    );
  }, [firestore, companyId, showAdminDashboard]);

  const { data: employees } = useCollection(employeesQuery);
  const {
    data: allJobs,
    isLoading: isJobsLoading,
    error: jobsError,
  } = useCollection(jobsQuery);
  const { data: financeRows = [] } = useCollection(financeQuery);
  const { data: attendanceRows = [] } = useCollection(attendanceQuery);
  const {
    data: dashboardDailyReports = [],
    isLoading: dailyReportsLoading,
  } = useCollection(dailyWorkReportsQuery);
  const {
    data: dashboardChatMessages = [],
    isLoading: chatDashboardLoading,
  } = useCollection(chatDashboardQuery);
  const {
    data: leadMeetingsRaw = [],
    isLoading: leadMeetingsLoading,
  } = useCollection(leadMeetingsQuery);

  const typedJobs: JobData[] = ((allJobs as JobData[] | undefined) ?? []);

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

  const todayIso = useMemo(
    () => new Date().toISOString().split("T")[0],
    []
  );

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
    let totalBudgetKc = 0;
    for (const j of typedJobs) {
      count += 1;
      const b = parseBudgetKcFromJob(j.budget);
      if (b != null) totalBudgetKc += b;
    }
    return { count, totalBudgetKc };
  }, [typedJobs]);

  const paidToEmployeesCzk = useMemo(() => {
    const rows = Array.isArray(dashboardDailyReports)
      ? (dashboardDailyReports as DailyWorkReportMoney[])
      : [];
    return sumMoneyForApprovedDailyReports(rows);
  }, [dashboardDailyReports]);

  const upcomingLeadMeetings = useMemo(() => {
    const list = Array.isArray(leadMeetingsRaw) ? leadMeetingsRaw : [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const cutoff = startOfToday.getTime();
    type Row = {
      id: string;
      customerName: string;
      phone?: string;
      email?: string;
      importLeadId?: string;
      leadKey?: string;
      place?: string;
      note?: string;
      at: Date;
    };
    const out: Row[] = [];
    for (const raw of list as Record<string, unknown>[]) {
      const id = String(raw?.id ?? "");
      if (!id) continue;
      const at = parseFirestoreScheduledAt(raw.scheduledAt);
      if (!at || at.getTime() < cutoff) continue;
      out.push({
        id,
        customerName: String(raw.customerName ?? "—"),
        phone: typeof raw.phone === "string" ? raw.phone : undefined,
        email: typeof raw.email === "string" ? raw.email : undefined,
        importLeadId: typeof raw.importLeadId === "string" ? raw.importLeadId : undefined,
        leadKey: typeof raw.leadKey === "string" ? raw.leadKey : undefined,
        place: typeof raw.place === "string" ? raw.place : undefined,
        note: typeof raw.note === "string" ? raw.note : undefined,
        at,
      });
    }
    out.sort((a, b) => a.at.getTime() - b.at.getTime());
    return out.slice(0, 18);
  }, [leadMeetingsRaw]);

  const unreadEmployeeChatCount = useMemo(() => {
    const rows = Array.isArray(dashboardChatMessages)
      ? dashboardChatMessages
      : [];
    return rows.filter(
      (m: { senderRole?: string; read?: boolean }) =>
        m.senderRole === "employee" && m.read !== true
    ).length;
  }, [dashboardChatMessages]);

  /** Příjmy = součet rozpočtů zakázek; náklady = schválené výplaty z výkazů; zisk = rozdíl (zjednodušený model). */
  const totalIncomeFromJobsCzk = jobsAggregate.totalBudgetKc;
  const totalLaborCostsCzk = paidToEmployeesCzk;
  const profitCzk = totalIncomeFromJobsCzk - totalLaborCostsCzk;

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
    jobsAggregate.totalBudgetKc,
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
          <p className="mt-2 text-xs text-slate-500">
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

      {!isCustomer && companyId ? (
        <DashboardOpenTasks
          companyId={companyId}
          employeeId={typedProfile?.employeeId}
          isPrivileged={isManagement || isAccountant}
        />
      ) : null}

      {showAdminDashboard ? (
        <div className="space-y-6">
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

          <Card className="overflow-hidden border-2 border-amber-400/90 bg-gradient-to-br from-amber-50 via-white to-orange-50/90 shadow-lg ring-1 ring-amber-200/70 dark:border-amber-500/60 dark:from-amber-950/50 dark:via-slate-950 dark:to-orange-950/30 dark:ring-amber-800/40">
            <CardHeader className="border-b border-amber-200/60 bg-amber-100/40 pb-3 dark:border-amber-800/40 dark:bg-amber-950/30">
              <CardTitle className="flex items-center gap-2 text-lg text-amber-950 dark:text-amber-50">
                <Calendar className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                Naplánované schůzky
              </CardTitle>
              <CardDescription className="text-amber-900/80 dark:text-amber-200/90">
                Obchodní schůzky naplánované z poptávek — od dnešního dne podle termínu.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {leadMeetingsLoading ? (
                <div className="flex justify-center py-10">
                  <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
                </div>
              ) : upcomingLeadMeetings.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Žádné nadcházející schůzky. Naplánujte je v sekci{" "}
                  <Link href="/portal/leads" className="font-medium text-primary underline-offset-2 hover:underline">
                    Poptávky
                  </Link>
                  .
                </p>
              ) : (
                <ul className="space-y-3">
                  {upcomingLeadMeetings.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-xl border border-amber-200/90 bg-white/95 p-4 shadow-sm dark:border-amber-800/50 dark:bg-slate-900/60"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{m.customerName}</p>
                          <p className="text-xs font-medium tabular-nums text-amber-800 dark:text-amber-300">
                            {format(m.at, "EEEE d. M. yyyy · HH:mm", { locale: cs })}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600 dark:text-slate-400">
                            {m.phone ? <span>Tel. {m.phone}</span> : null}
                            {m.email ? <span className="break-all">{m.email}</span> : null}
                          </div>
                          {m.place ? (
                            <p className="text-xs text-slate-500 dark:text-slate-500">Místo: {m.place}</p>
                          ) : null}
                          {m.note ? (
                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">{m.note}</p>
                          ) : null}
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">
                            Poptávka ID: {m.importLeadId ?? "—"}
                            {m.leadKey ? ` · klíč: ${m.leadKey}` : ""}
                          </p>
                        </div>
                        <Link
                          href="/portal/leads"
                          className="shrink-0 text-sm font-medium text-primary hover:underline"
                        >
                          Poptávky →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

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
                    <p className="pt-2 text-lg font-semibold tabular-nums text-foreground">
                      {isJobsLoading ? (
                        <span className="text-muted-foreground">…</span>
                      ) : (
                        formatKc(jobsAggregate.totalBudgetKc)
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">Součet rozpočtů (Kč)</p>
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
                  <span className="text-muted-foreground">Příjmy (rozpočty)</span>
                  <span className="font-semibold tabular-nums">
                    {isJobsLoading ? "…" : formatKc(totalIncomeFromJobsCzk)}
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
                  Zisk = součet rozpočtů zakázek minus schválené částky z výkazů. Nezahrnuje ostatní náklady.
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
                  <div className="portal-kpi-value">{employees?.length || 0}</div>
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
                <div className="portal-kpi-value">{employees?.length || 0}</div>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
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
                  <div key={job.id} className="space-y-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900">
                          {job.name || "Bez názvu"}
                        </span>
                        <span className="text-[10px] font-medium uppercase text-slate-600">
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
                <div className="py-12 text-center text-slate-600">
                  Zatím nemáte žádné zakázky.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

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