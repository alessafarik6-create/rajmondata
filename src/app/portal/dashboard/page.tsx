"use client";

import React, { useMemo } from "react";
import {
  Users,
  Briefcase,
  Clock,
  Wallet,
  Activity,
  ArrowRight,
  AlertCircle,
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
  useDoc,
  useMemoFirebase,
  useCollection,
  useCompany,
} from "@/firebase";
import {
  doc,
  collection,
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";
import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/platform-brand";

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
  assignedEmployeeIds?: string[];
  customerId?: string;
};

export default function CompanyDashboard() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );

  const {
    data: profile,
    isLoading: isProfileLoading,
    error: profileError,
  } = useDoc(userRef);

  const typedProfile = (profile as ProfileData | null) ?? null;
  const companyId = typedProfile?.companyId;
  const role = typedProfile?.role || "employee";

  const isManagement = ["owner", "admin", "manager"].includes(role);
  const isAccountant = role === "accountant";
  const isEmployee = role === "employee";
  const isCustomer = role === "customer";

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

  const { data: employees } = useCollection(employeesQuery);
  const {
    data: allJobs,
    isLoading: isJobsLoading,
    error: jobsError,
  } = useCollection(jobsQuery);
  const { data: financeRows = [] } = useCollection(financeQuery);
  const { data: attendanceRows = [] } = useCollection(attendanceQuery);

  const { companyName } = useCompany();

  const typedJobs: JobData[] = ((allJobs as JobData[] | undefined) ?? []);

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

  if (isProfileLoading) {
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
            <Link href="/portal/attendance" className="min-w-[44px]">
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
                <Link href="/portal/attendance">
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