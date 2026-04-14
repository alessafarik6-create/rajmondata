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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatKc } from "@/lib/employee-money";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";
import { EmployeeAttendanceOverview } from "./employee-attendance-overview";
import { isFirestoreIndexError } from "@/firebase/firestore/firestore-query-errors";
import { EmployeeNotificationsPanel } from "@/components/employee/EmployeeNotificationsPanel";
import { Badge } from "@/components/ui/badge";
import { useEmployeeNotificationUnreadCount } from "@/hooks/use-employee-notification-unread-count";

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
  const { unreadCount: homeNotifUnread } = useEmployeeNotificationUnreadCount({
    companyId,
    employeeId,
  });

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

  const photoUrl = profile?.profileImage || profile?.photoUrl;

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

  const panel =
    "border-2 border-neutral-950 bg-white text-neutral-950 shadow-sm rounded-xl";

  return (
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8 px-2 sm:px-0">
      <DashboardOpenTasks
        companyId={companyId}
        employeeId={employeeId}
        isPrivileged={false}
      />

      <EmployeeNotificationsPanel
        companyId={companyId}
        employeeId={employeeId}
        compact
      />

      <div
        className={cn(
          "flex flex-col gap-4 rounded-xl border-2 border-neutral-950 bg-white p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-6"
        )}
      >
        <Avatar className="h-24 w-24 shrink-0 border-2 border-neutral-950">
          <AvatarImage src={photoUrl || undefined} alt="" className="object-cover" />
          <AvatarFallback className="text-2xl font-semibold bg-orange-500 text-white">
            {displayName && displayName[0]
              ? displayName[0].toUpperCase()
              : "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
            <span>
              {t("goodDay")}, {greetingName}!
            </span>
            {homeNotifUnread > 0 ? (
              <Badge
                variant="destructive"
                className="text-xs font-semibold tabular-nums"
                title={`Nepřečtená upozornění: ${homeNotifUnread}`}
              >
                {homeNotifUnread > 99 ? "99+" : homeNotifUnread} nepřečtených
              </Badge>
            ) : null}
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

      {user && (
        <EmployeeAttendanceOverview
          companyId={companyId}
          employeeId={employeeId}
          authUserId={user.uid}
          employeeDisplayName={displayName}
          companyName={companyName}
          hourlyRate={hourlyRateEmployee}
        />
      )}

      <Card className={cn(panel)}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-neutral-950">
            Denní výkazy a částky
          </CardTitle>
          <p className="mt-1 text-sm text-neutral-800">
            Náhled — celková historie výkazů. Úpravy provedete v sekci{" "}
            <Link
              href="/portal/employee/daily-reports"
              className="font-medium text-neutral-950 underline underline-offset-2"
            >
              Denní výkazy
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent className="text-sm text-neutral-900">
          {dailyReportsLoading ? (
            <p className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám výkazy…
            </p>
          ) : dailyReportsLoadFailed ? (
            <Alert className="border-amber-300 bg-amber-50 text-amber-950">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Výkazy se nepodařilo načíst</AlertTitle>
              <AlertDescription>
                {isFirestoreIndexError(dailyReportsError)
                  ? "Data se z databáze momentálně nepodařilo načíst. Zkuste stránku později nebo kontaktujte administrátora."
                  : "Zkuste obnovit stránku. Pokud problém přetrvává, kontaktujte administrátora."}
              </AlertDescription>
            </Alert>
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
