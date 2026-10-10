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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatKc } from "@/lib/employee-money";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import {
  Loader2,
  AlertCircle,
  CalendarDays,
  ClipboardList,
  Clock,
  ListTodo,
} from "lucide-react";
import {
  EmployeeCompactHeader,
  EmployeePortalPageShell,
  EmployeePortalSection,
  EmployeePortalSections,
  EmployeeStatGrid,
  EmployeeStatTile,
  EmployeeMobileRecordRow,
} from "@/components/employee-portal/employee-portal-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";
import { CompanyScheduleCalendar } from "@/components/portal/company-schedule-calendar";
import { EmployeeAttendanceOverview } from "./employee-attendance-overview";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
import { usePortalPermissions } from "@/contexts/portal-permissions-context";

const DEBUG_EMPLOYEE_HOME = process.env.NODE_ENV === "development";

const silentFirestoreListen = { suppressGlobalPermissionError: true as const };

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
  const { calendar, canRead } = usePortalPermissions();
  const showCalendarBlock = calendar.anyView;
  const calendarBlockTitle =
    calendar.meetings.view && calendar.installations.view
      ? "Můj kalendář"
      : calendar.installations.view
        ? "Moje montáže"
        : "Moje schůzky";
  const calendarBlockDescription =
    calendar.meetings.view && calendar.installations.view
      ? "Naplánované schůzky a montáže přiřazené vám."
      : calendar.installations.view
        ? "Naplánované montáže přiřazené vám. Klepnutím na událost otevřete detail."
        : "Naplánované schůzky přiřazené vám. Klepnutím na událost otevřete detail.";
  const calendarScheduleFilter =
    calendar.meetings.view && !calendar.installations.view
      ? "meetingsOnly"
      : !calendar.meetings.view && calendar.installations.view
        ? "installationsOnly"
        : "all";
  const showTasks = canRead("jobs");
  const showAttendance = canRead("labor");

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc } = useDoc<any>(employeeRef);

  const dailyReportsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !employeeId) return null;
    return query(
      collection(firestore, "companies", companyId, "daily_work_reports"),
      where("employeeId", "==", employeeId),
      limit(200)
    );
  }, [firestore, companyId, employeeId]);

  const {
    data: dailyReportsRaw,
    isLoading: dailyReportsLoading,
    error: dailyReportsError,
    isIndexPending: dailyReportsIndexPending,
  } = useCollection(dailyReportsQuery, silentFirestoreListen);

  const dailyReportsSorted = useMemo(() => {
    const r = Array.isArray(dailyReportsRaw) ? dailyReportsRaw : [];
    return [...r].sort((a: { date?: string }, b: { date?: string }) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
  }, [dailyReportsRaw]);

  const dailyReportsLoadFailed =
    !dailyReportsLoading && (dailyReportsError != null || dailyReportsIndexPending);

  const dailyReportStats = useMemo(() => {
    let approvedAmount = 0;
    let approvedHours = 0;
    let pendingCount = 0;
    for (const row of dailyReportsSorted) {
      const st = String((row as { status?: string }).status || "");
      const payable = (row as { payableAmountCzk?: number }).payableAmountCzk;
      const hRaw =
        (row as { hoursConfirmed?: unknown }).hoursConfirmed ??
        (row as { hoursFromAttendance?: unknown }).hoursFromAttendance;
      const h = hRaw != null ? Number(hRaw) : null;
      if (st === "approved") {
        if (typeof payable === "number" && Number.isFinite(payable)) approvedAmount += payable;
        if (h != null && Number.isFinite(h)) approvedHours += h;
      }
      if (st === "pending" || st === "draft" || st === "returned") pendingCount += 1;
    }
    return { approvedAmount, approvedHours, pendingCount };
  }, [dailyReportsSorted]);

  const hourlyRateEmployee = useMemo(() => {
    const raw = employeeDoc?.hourlyRate ?? profile?.hourlyRate;
    if (raw == null || raw === "") return 0;
    const n =
      typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [employeeDoc?.hourlyRate, profile?.hourlyRate]);

  const displayName =
    profile?.displayName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    "Zaměstnanec";

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      console.log("[employee/page] employee.hourlyRate", employeeDoc?.hourlyRate ?? profile?.hourlyRate);
    }
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
        profileError: profileError?.message ?? null,
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
    profileError,
    employeeDoc,
  ]);

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Ověřujeme přihlášení…</p>
      </div>
    );
  }

  if (isProfileLoading) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-slate-800">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Načítání profilu…</p>
      </div>
    );
  }

  // Upozornění z kalendáře / systému – v profilu i na domovské stránce zaměstnance.
  // Zobrazuje se i na mobilu; nepřečtené zvýrazní.

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

  const headerSubtitle = [
    profile?.jobTitle || "Pracovní pozice není vyplněná",
    companyName && companyName !== "Organization" ? companyName : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const reportsSummary =
    dailyReportsLoading
      ? "Načítám výkazy…"
      : dailyReportsLoadFailed
        ? "Výkazy se nepodařilo načíst"
        : dailyReportsSorted.length === 0
          ? "Zatím žádný výkaz"
          : `${dailyReportsSorted.length} záznamů · schváleno ${formatKc(dailyReportStats.approvedAmount)}`;

  const dailyReportsPreview = (
    <div className="space-y-3 text-sm text-slate-800">
      <p className="text-xs text-slate-600">
        Úpravy v sekci{" "}
        <Link
          href="/portal/employee/daily-reports"
          className="font-medium text-orange-700 underline underline-offset-2"
        >
          Denní výkazy
        </Link>
        .
      </p>
      {dailyReportsLoading ? (
        <p className="flex items-center gap-2 text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
          Načítám výkazy…
        </p>
      ) : dailyReportsLoadFailed ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Výkazy se nepodařilo načíst</AlertTitle>
          <AlertDescription>
            {isFirestoreIndexError(dailyReportsError)
              ? "Zkuste stránku později nebo kontaktujte administrátora."
              : "Zkuste obnovit stránku."}
          </AlertDescription>
        </Alert>
      ) : dailyReportsSorted.length === 0 ? (
        <p className="text-slate-600">Zatím nemáte žádný denní výkaz.</p>
      ) : (
        <>
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-200 bg-slate-50/80 hover:bg-slate-50/80">
                  <TableHead className="text-xs font-semibold text-slate-700">Datum</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">Hodiny</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">Částka</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700">Stav</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dailyReportsSorted.slice(0, 12).map((row: Record<string, unknown>, idx: number) => {
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
                    <TableRow key={`${String(row.date)}-${idx}`} className="border-b border-slate-100">
                      <TableCell className="whitespace-nowrap font-medium text-slate-900">
                        {String(row.date || "—")}
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-800">
                        {h != null && Number.isFinite(h) ? `${h} h` : "—"}
                      </TableCell>
                      <TableCell className="tabular-nums text-slate-800">
                        {amt > 0 ? formatKc(amt) : "—"}
                      </TableCell>
                      <TableCell className="text-slate-700">{dailyReportStatusLabel(st)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-2 sm:hidden">
            {dailyReportsSorted.slice(0, 8).map((row: Record<string, unknown>, idx: number) => {
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
                <li key={`${String(row.date)}-${idx}`}>
                  <EmployeeMobileRecordRow
                    primary={String(row.date || "—")}
                    secondary={dailyReportStatusLabel(st)}
                    trailing={
                      <span className="text-xs tabular-nums text-slate-800">
                        {amt > 0 ? formatKc(amt) : h != null && Number.isFinite(h) ? `${h} h` : "—"}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
          {dailyReportsSorted.length > 12 ? (
            <p className="text-xs text-slate-500">
              Zobrazeno posledních 12 z {dailyReportsSorted.length}. Kompletní historie v Denních výkazech.
            </p>
          ) : null}
        </>
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        Do výplaty se započítávají jen schválené denní výkazy.
      </p>
    </div>
  );

  return (
    <EmployeePortalPageShell>
      <EmployeeCompactHeader
        title={`${t("goodDay")}, ${greetingName}!`}
        subtitle={headerSubtitle}
      />

      <EmployeeStatGrid>
        {showAttendance ? (
          <EmployeeStatTile
            label="Docházka"
            value="Přehled"
            hint="Otevřete sekci níže pro detail a historii"
          />
        ) : null}
        <EmployeeStatTile
          label="Schválený výdělek"
          value={
            dailyReportsLoading
              ? "…"
              : formatKc(dailyReportStats.approvedAmount)
          }
          hint={
            dailyReportStats.approvedHours > 0
              ? `${dailyReportStats.approvedHours.toLocaleString("cs-CZ")} h schváleno`
              : undefined
          }
        />
        <EmployeeStatTile
          label="Výkazy ke schválení"
          value={dailyReportStats.pendingCount}
          hint={
            dailyReportStats.pendingCount > 0
              ? "Rozpracované nebo odeslané"
              : "Žádné čekající"
          }
        />
      </EmployeeStatGrid>

      <EmployeePortalSections>
        {showCalendarBlock ? (
          <EmployeePortalSection
            value="calendar"
            icon={CalendarDays}
            title={calendarBlockTitle}
            summary={calendarBlockDescription}
          >
            <CompanyScheduleCalendar
              companyId={companyId}
              headingTitle={calendarBlockTitle}
              layout="full"
              appearance="default"
              readOnly={!calendar.anyWrite}
              restrictEmployeeEvents
              scheduleFilter={calendarScheduleFilter}
            />
          </EmployeePortalSection>
        ) : null}

        {showTasks ? (
          <EmployeePortalSection
            value="tasks"
            icon={ListTodo}
            title="Moje úkoly"
            summary="Aktivní úkoly přiřazené vám nebo všem"
          >
            <DashboardOpenTasks
              companyId={companyId}
              employeeId={employeeId}
              isPrivileged={false}
            />
          </EmployeePortalSection>
        ) : null}

        {user && showAttendance ? (
          <EmployeePortalSection
            value="attendance"
            icon={Clock}
            title="Docházka"
            summary="Denní přehled, historie a odpracované hodiny"
          >
            <EmployeeAttendanceOverview
              companyId={companyId}
              employeeId={employeeId}
              authUserId={user.uid}
              employeeDisplayName={displayName}
              companyName={companyName}
              hourlyRate={hourlyRateEmployee}
            />
          </EmployeePortalSection>
        ) : null}

        <EmployeePortalSection
          value="reports"
          icon={ClipboardList}
          title="Denní výkazy a částky"
          summary={reportsSummary}
        >
          {dailyReportsPreview}
        </EmployeePortalSection>
      </EmployeePortalSections>
    </EmployeePortalPageShell>
  );
}
