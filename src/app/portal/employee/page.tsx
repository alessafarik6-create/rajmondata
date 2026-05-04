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
import { Loader2, AlertCircle, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsBelowLg } from "@/hooks/use-mobile";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardOpenTasks } from "@/components/tasks/dashboard-open-tasks";
import { CompanyScheduleCalendar } from "@/components/portal/company-schedule-calendar";
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
  const belowLg = useIsBelowLg();

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

  const contactEmail = String(profile?.email || user?.email || "").trim();
  const contactPhone = String(profile?.phone ?? employeeDoc?.phone ?? "").trim();

  const shellClass = cn(
    "mx-auto max-w-5xl",
    belowLg && "min-h-screen overflow-x-hidden bg-slate-950 px-3 pb-12 pt-4",
    !belowLg && "space-y-6 sm:space-y-8 px-2 sm:px-0"
  );

  const sectionCard = cn(
    "rounded-2xl border p-4 shadow-sm sm:p-5",
    belowLg ? "border-white/10 bg-slate-900/95 text-slate-100" : panel
  );

  const headTitle = cn("text-base font-semibold", belowLg ? "text-white" : "text-neutral-950");
  const headSub = cn("mt-1 text-sm", belowLg ? "text-slate-400" : "text-neutral-800");
  const linkClass = belowLg
    ? "font-medium text-orange-400 underline underline-offset-2"
    : "font-medium text-neutral-950 underline underline-offset-2";

  return (
    <div className={shellClass}>
      <section className={cn(sectionCard, "mb-4")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar
            className={cn(
              "h-20 w-20 shrink-0 sm:h-24 sm:w-24",
              belowLg ? "border-2 border-white/20" : "border-2 border-neutral-950"
            )}
          >
            <AvatarImage src={photoUrl || undefined} alt="" className="object-cover" />
            <AvatarFallback className="text-2xl font-semibold bg-orange-500 text-white">
              {displayName && displayName[0] ? displayName[0].toUpperCase() : "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1
              className={cn(
                "flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight sm:text-3xl",
                belowLg ? "text-white" : "text-neutral-950"
              )}
            >
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
            <p className={cn("mt-2 text-base leading-relaxed", belowLg ? "text-slate-200" : "text-neutral-950")}>
              {profile?.jobTitle ? (
                <span className="font-semibold">{profile.jobTitle}</span>
              ) : (
                <span>Pracovní pozice není vyplněná.</span>
              )}
              {companyName && companyName !== "Organization" ? (
                <span
                  className={cn(
                    "mt-1 block text-sm font-medium",
                    belowLg ? "text-slate-300" : "text-neutral-900"
                  )}
                >
                  {companyName}
                </span>
              ) : null}
            </p>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              {contactEmail ? (
                <a
                  href={`mailto:${contactEmail}`}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-lg py-1 transition-colors",
                    belowLg ? "text-orange-400 hover:text-orange-300" : "text-primary hover:underline"
                  )}
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="break-all">{contactEmail}</span>
                </a>
              ) : null}
              {contactPhone ? (
                <a
                  href={`tel:${contactPhone.replace(/\s/g, "")}`}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-lg py-1 transition-colors",
                    belowLg ? "text-orange-400 hover:text-orange-300" : "text-primary hover:underline"
                  )}
                >
                  <Phone className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{contactPhone}</span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className={cn(sectionCard, "mb-4")}>
        <h2 className={cn(headTitle)}>Moje montáže</h2>
        <p className={cn(headSub, "mb-3")}>
          Naplánované montáže přiřazené vám. Klepnutím na událost otevřete detail.
        </p>
        <CompanyScheduleCalendar
          companyId={companyId}
          headingTitle="Moje montáže"
          layout="full"
          appearance={belowLg ? "darkPortal" : "default"}
          readOnly
          restrictEmployeeEvents
          scheduleFilter="installationsOnly"
        />
      </section>

      <section className={cn(sectionCard, "mb-4 space-y-3")}>
        <h2 className={cn(headTitle)}>Moje úkoly</h2>
        <DashboardOpenTasks companyId={companyId} employeeId={employeeId} isPrivileged={false} />
      </section>

      {user ? (
        <section className={cn(sectionCard, "mb-4")}>
          <h2 className={cn(headTitle, "mb-3")}>Docházka</h2>
          <EmployeeAttendanceOverview
            companyId={companyId}
            employeeId={employeeId}
            authUserId={user.uid}
            employeeDisplayName={displayName}
            companyName={companyName}
            hourlyRate={hourlyRateEmployee}
          />
        </section>
      ) : null}

      {belowLg ? (
        <Accordion type="multiple" className="space-y-2 pb-4">
          <AccordionItem
            value="notifications"
            className="rounded-2xl border border-white/10 bg-slate-900/95 px-3 text-slate-100"
          >
            <AccordionTrigger className="py-4 text-left text-base font-semibold hover:no-underline">
              Upozornění
            </AccordionTrigger>
            <AccordionContent className="pb-4 pt-0">
              <EmployeeNotificationsPanel companyId={companyId} employeeId={employeeId} compact />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem
            value="reports"
            className="rounded-2xl border border-white/10 bg-slate-900/95 px-3 text-slate-100"
          >
            <AccordionTrigger className="py-4 text-left text-base font-semibold hover:no-underline">
              Denní výkazy a částky
            </AccordionTrigger>
            <AccordionContent className="pb-4 pt-0">
              <p className="mb-3 text-sm text-slate-400">
                Úpravy v sekci{" "}
                <Link href="/portal/employee/daily-reports" className={linkClass}>
                  Denní výkazy
                </Link>
                .
              </p>
              {dailyReportsLoading ? (
                <p className="flex items-center gap-2 text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                  Načítám výkazy…
                </p>
              ) : dailyReportsLoadFailed ? (
                <Alert className="border-amber-500/40 bg-amber-950/40 text-amber-50">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Výkazy se nepodařilo načíst</AlertTitle>
                  <AlertDescription className="text-amber-100">
                    {isFirestoreIndexError(dailyReportsError)
                      ? "Zkuste stránku později nebo kontaktujte administrátora."
                      : "Zkuste obnovit stránku."}
                  </AlertDescription>
                </Alert>
              ) : dailyReportsSorted.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Zatím nemáte žádný denní výkaz.
                </p>
              ) : (
                <ul className="space-y-3">
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
                      <li
                        key={`${String(row.date)}-${idx}`}
                        className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-white">{String(row.date || "—")}</span>
                          <span className="text-xs text-orange-300">{dailyReportStatusLabel(st)}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-slate-300">
                          <div>
                            <span className="text-[11px] uppercase text-slate-500">Hodiny</span>
                            <p className="tabular-nums">
                              {h != null && Number.isFinite(h) ? `${h} h` : "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-[11px] uppercase text-slate-500">Částka</span>
                            <p className="tabular-nums">{amt > 0 ? formatKc(amt) : "—"}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                Do výplaty se započítávají jen schválené denní výkazy.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <>
          <EmployeeNotificationsPanel companyId={companyId} employeeId={employeeId} compact />

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
        </>
      )}
    </div>
  );
}
