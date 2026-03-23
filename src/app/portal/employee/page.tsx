"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, collection, query, where, limit } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  summarizeAttendanceByDay,
  sumHoursTodayAndWeek,
} from "@/lib/employee-attendance";
import { formatKc } from "@/lib/employee-money";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import {
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  CircleDollarSign,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";

const DEBUG_EMPLOYEE_HOME = process.env.NODE_ENV === "development";

export default function EmployeeHomePage() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName, isLoading: companyLoading } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading, error: profileError } =
    useDoc<any>(userRef);

  const { t } = useEmployeeUiLang(profile);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user) return null;
    const ids = [...new Set([employeeId, user.uid].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    if (ids.length === 1) {
      return query(base, where("employeeId", "==", ids[0]), limit(400));
    }
    return query(base, where("employeeId", "in", ids), limit(400));
  }, [firestore, companyId, employeeId, user]);

  const {
    data: rawRows,
    isLoading: attendanceLoading,
    error: attendanceError,
  } = useCollection(attendanceQuery);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      limit(200)
    );
  }, [firestore, companyId, employeeId]);

  const {
    data: dailyReportsRaw = [],
    isLoading: dailyReportsLoading,
  } = useCollection(dailyReportsQuery);

  const dailyReportsSorted = useMemo(() => {
    const r = Array.isArray(dailyReportsRaw) ? dailyReportsRaw : [];
    return [...r].sort((a: { date?: string }, b: { date?: string }) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
  }, [dailyReportsRaw]);

  /** Součet orientačních částek z výkazů (evidence práce; není to závazná výplata). */
  const totalEstimatedPayCzk = useMemo(() => {
    let s = 0;
    for (const row of dailyReportsSorted as Record<string, unknown>[]) {
      const st = String(row.status || "");
      if (st === "rejected") continue;
      const n = row.estimatedLaborFromSegmentsCzk;
      if (typeof n === "number" && Number.isFinite(n)) s += n;
    }
    return Math.round(s * 100) / 100;
  }, [dailyReportsSorted]);

  /** Součet částek potvrzených administrátorem (schválené výkazy). */
  const totalApprovedPayCzk = useMemo(() => {
    let s = 0;
    for (const row of dailyReportsSorted as Record<string, unknown>[]) {
      if (String(row.status) !== "approved") continue;
      const n = row.payableAmountCzk;
      if (typeof n === "number" && Number.isFinite(n)) s += n;
    }
    return Math.round(s * 100) / 100;
  }, [dailyReportsSorted]);

  const hasApprovedReport = useMemo(
    () =>
      dailyReportsSorted.some(
        (row: Record<string, unknown>) => String(row.status) === "approved"
      ),
    [dailyReportsSorted]
  );

  const safeRows = Array.isArray(rawRows) ? rawRows : [];

  const summaries = useMemo(() => {
    try {
      return summarizeAttendanceByDay(safeRows as any[], {
        employeeId,
        authUid: user?.uid,
      });
    } catch (e) {
      console.error("[employee/page] summarizeAttendanceByDay", e);
      return [];
    }
  }, [safeRows, employeeId, user?.uid]);

  const { today, week } = useMemo(
    () => sumHoursTodayAndWeek(summaries),
    [summaries]
  );

  const todayIso = new Date().toISOString().split("T")[0];
  const todaySummary = summaries.find((s) => s.date === todayIso);

  const displayName =
    profile?.displayName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Zaměstnanec";

  const photoUrl = profile?.profileImage || profile?.photoUrl;

  useEffect(() => {
    if (DEBUG_EMPLOYEE_HOME && typeof window !== "undefined") {
      console.log("[employee/page]", {
        route: pathname,
        uid: user?.uid ?? null,
        role: profile?.role ?? null,
        companyId: companyId ?? null,
        employeeId: employeeId ?? null,
        employeeProfile: profile
          ? {
              id: profile.id,
              firstName: profile.firstName,
              jobTitle: profile.jobTitle,
            }
          : null,
        isUserLoading,
        isProfileLoading,
        companyLoading,
        attendanceLoading,
        profileError: profileError?.message ?? null,
        attendanceError: attendanceError?.message ?? null,
      });
    }
  }, [
    pathname,
    user?.uid,
    profile,
    companyId,
    employeeId,
    isUserLoading,
    isProfileLoading,
    companyLoading,
    attendanceLoading,
    profileError,
    attendanceError,
  ]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (isProfileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Načítání profilu…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Profil nebyl nalezen</AlertTitle>
        <AlertDescription>
          Dokument uživatele ve Firestore chybí. Kontaktujte administrátora.
        </AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Chybí organizace</AlertTitle>
        <AlertDescription>
          V profilu není nastavené <strong>companyId</strong>. Přiřazení firmy
          může provést jen administrátor.
        </AlertDescription>
      </Alert>
    );
  }

  if (!employeeId) {
    return (
      <Alert className="max-w-lg border-amber-200 bg-amber-50 text-amber-950">
        <AlertCircle className="h-4 w-4 text-amber-700" />
        <AlertTitle>Profil zaměstnance nebyl nalezen</AlertTitle>
        <AlertDescription>
          V účtu chybí propojení na záznam zaměstnance (
          <code className="text-xs">employeeId</code>). Kontaktujte
          administrátora — bez něj nelze správně zobrazit docházku a výkazy.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba načtení profilu</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  const greetingName =
    profile?.firstName ||
    (typeof displayName === "string" ? displayName.split(" ")[0] : "") ||
    t("colleague");

  const dailyReportStatusLabel = (s: string | undefined) => {
    switch (s) {
      case "draft":
        return "Rozpracováno";
      case "pending":
        return "Odesláno ke schválení";
      case "approved":
        return "Schváleno";
      case "rejected":
        return "Zamítnuto";
      case "returned":
        return "K úpravě";
      default:
        return s || "—";
    }
  };

  const panel =
    "border-2 border-neutral-950 bg-white text-neutral-950 shadow-sm rounded-xl";

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8 px-2 sm:px-0">
      {attendanceError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Docházku nelze načíst</AlertTitle>
          <AlertDescription>
            {attendanceError.message ||
              "Nemáte oprávnění číst kolekci docházky, nebo došlo k chybě sítě."}
          </AlertDescription>
        </Alert>
      ) : null}

      <DashboardOpenTasks
        companyId={companyId}
        employeeId={employeeId}
        isPrivileged={false}
      />

      <div
        className={cn(
          "flex flex-col gap-4 rounded-xl border-2 border-neutral-950 bg-white p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6"
        )}
      >
        <Avatar className="h-24 w-24 shrink-0 border-2 border-neutral-950">
          <AvatarImage src={photoUrl || undefined} alt="" className="object-cover" />
          <AvatarFallback className="text-2xl bg-neutral-950 text-white">
            {(displayName && displayName[0]
              ? displayName[0].toUpperCase()
              : "?")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
            {t("goodDay")}, {greetingName}!
          </h1>
          <p className="mt-2 text-base leading-relaxed text-neutral-950">
            {profile?.jobTitle ? (
              <span className="font-semibold">{profile.jobTitle}</span>
            ) : (
              <span>Pracovní pozice není vyplněná.</span>
            )}
            {companyName && companyName !== "Organization" ? (
              <span className="mt-1 block text-sm font-medium text-neutral-900">{companyName}</span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={cn(panel)}>
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <CircleDollarSign className="h-4 w-4 shrink-0" aria-hidden />
              Orientační částka
            </CardTitle>
            <p className="text-xs leading-relaxed text-neutral-900">
              Odhad z evidované práce a sazeb — pouze orientační hodnota,{" "}
              <strong className="text-neutral-950">ještě nebyla schválena</strong> administrátorem.
            </p>
          </CardHeader>
          <CardContent>
            {dailyReportsLoading ? (
              <p className="flex items-center gap-2 text-sm text-neutral-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám výkazy…
              </p>
            ) : (
              <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-950 sm:text-3xl">
                {formatKc(totalEstimatedPayCzk)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className={cn(panel)}>
          <CardHeader className="space-y-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <BadgeCheck className="h-4 w-4 shrink-0" aria-hidden />
              Schválená částka
            </CardTitle>
            <p className="text-xs leading-relaxed text-neutral-900">
              Částka <strong className="text-neutral-950">potvrzená administrátorem</strong> jako podklad
              k výplatě (součet schválených denních výkazů).
            </p>
          </CardHeader>
          <CardContent>
            {dailyReportsLoading ? (
              <p className="flex items-center gap-2 text-sm text-neutral-900">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám výkazy…
              </p>
            ) : hasApprovedReport ? (
              <p className="text-2xl font-bold tabular-nums tracking-tight text-neutral-950 sm:text-3xl">
                {formatKc(totalApprovedPayCzk)}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-lg font-semibold text-neutral-950">Zatím neschváleno</p>
                <p className="text-sm text-neutral-900">
                  Žádný denní výkaz zatím nemá stav Schváleno.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={cn(panel)}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <Clock className="h-4 w-4" aria-hidden />
              Hodiny
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-neutral-900">
            {attendanceLoading ? (
              <p className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám docházku…
              </p>
            ) : (
              <>
                <div className="flex justify-between gap-4">
                  <span className="font-medium text-neutral-950">{t("today")}</span>
                  <span className="font-semibold tabular-nums text-neutral-950">
                    {today > 0 ? `${today} h` : "—"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="font-medium text-neutral-950">Tento týden (po–dnes)</span>
                  <span className="font-semibold tabular-nums text-neutral-950">
                    {week > 0 ? `${week} h` : "—"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className={cn(panel)}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-neutral-950">
              <Calendar className="h-4 w-4" aria-hidden />
              {t("dayOverview")} ({todayIso})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-neutral-900">
            {attendanceLoading ? (
              <p className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám…
              </p>
            ) : todaySummary ? (
              <>
                <p>
                  <span className="font-medium text-neutral-950">Příchod:</span>{" "}
                  {todaySummary.checkIn ?? "—"}
                </p>
                <p>
                  <span className="font-medium text-neutral-950">Odchod:</span>{" "}
                  {todaySummary.checkOut ?? "—"}
                </p>
                <p>
                  <span className="font-medium text-neutral-950">Odpracováno:</span>{" "}
                  {todaySummary.hoursWorked != null
                    ? `${todaySummary.hoursWorked} h`
                    : "—"}
                </p>
                <p>
                  <span className="font-medium text-neutral-950">Stav:</span>{" "}
                  {todaySummary.statusLabel}
                </p>
              </>
            ) : (
              <p className="text-neutral-900">{t("noAttendanceToday")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className={cn(panel)}>
        <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base font-semibold text-neutral-950">
            Denní výkazy a částky
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="w-full border-2 border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-100 sm:w-auto"
          >
            <Link href="/portal/employee/daily-reports">Upravit výkazy</Link>
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-neutral-900">
          {dailyReportsLoading ? (
            <p className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám výkazy…
            </p>
          ) : dailyReportsSorted.length === 0 ? (
            <p>
              Zatím nemáte žádný denní výkaz. Částka se započte až po schválení administrátorem.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border-2 border-neutral-950">
              <Table>
                <TableHeader>
                  <TableRow className="border-b-2 border-neutral-950 bg-white hover:bg-white">
                    <TableHead className="font-semibold text-neutral-950">Datum</TableHead>
                    <TableHead className="font-semibold text-neutral-950">Hodiny</TableHead>
                    <TableHead className="font-semibold text-neutral-950">Částka (po schv.)</TableHead>
                    <TableHead className="font-semibold text-neutral-950">Stav</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyReportsSorted.map((row: Record<string, unknown>, idx: number) => {
                    const st = String(row.status || "");
                    const amt =
                      st === "approved" && typeof row.payableAmountCzk === "number"
                        ? (row.payableAmountCzk as number)
                        : 0;
                    const h =
                      row.hoursConfirmed != null
                        ? Number(row.hoursConfirmed)
                        : row.hoursFromAttendance != null
                          ? Number(row.hoursFromAttendance)
                          : null;
                    return (
                      <TableRow
                        key={`${String(row.date)}-${idx}`}
                        className="border-b border-neutral-950/20"
                      >
                        <TableCell className="whitespace-nowrap font-medium text-neutral-950">
                          {String(row.date || "—")}
                        </TableCell>
                        <TableCell className="tabular-nums text-neutral-950">
                          {h != null && Number.isFinite(h) ? `${h} h` : "—"}
                        </TableCell>
                        <TableCell className="tabular-nums text-neutral-950">
                          {amt > 0 ? formatKc(amt) : "—"}
                        </TableCell>
                        <TableCell className="text-neutral-950">{dailyReportStatusLabel(st)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-neutral-900">
            Do výplaty se započítávají jen schválené denní výkazy. Docházka sama o sobě peníze nevyplácí.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
