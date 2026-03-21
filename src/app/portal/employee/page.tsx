"use client";

import React, { useEffect, useMemo } from "react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  summarizeAttendanceByDay,
  sumHoursTodayAndWeek,
} from "@/lib/employee-attendance";
import { useEmployeeUiLang } from "@/hooks/use-employee-ui-lang";
import { Calendar, Clock, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

  return (
    <div className="space-y-6 sm:space-y-8 max-w-4xl">
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

      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <Avatar className="h-24 w-24 border-4 border-primary/20 shrink-0">
          <AvatarImage src={photoUrl || undefined} alt="" className="object-cover" />
          <AvatarFallback className="text-2xl bg-primary text-white">
            {(displayName && displayName[0]
              ? displayName[0].toUpperCase()
              : "?")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            {t("goodDay")}, {greetingName}!
          </h1>
          <p className="portal-page-description mt-1">
            {profile?.jobTitle ? (
              <span className="font-semibold text-slate-800">
                {profile.jobTitle}
              </span>
            ) : (
              <span>Pracovní pozice není vyplněná.</span>
            )}
            {companyName && companyName !== "Organization" ? (
              <span className="block text-sm text-slate-600 mt-1">
                {companyName}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Hodiny
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-slate-700">
            {attendanceLoading ? (
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám docházku…
              </p>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>{t("today")}</span>
                  <span className="font-semibold tabular-nums">
                    {today > 0 ? `${today} h` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tento týden (po–dnes)</span>
                  <span className="font-semibold tabular-nums">
                    {week > 0 ? `${week} h` : "—"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              {t("dayOverview")} ({todayIso})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-1">
            {attendanceLoading ? (
              <p className="text-slate-500 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Načítám…
              </p>
            ) : todaySummary ? (
              <>
                <p>
                  <span className="text-slate-500">Příchod:</span>{" "}
                  {todaySummary.checkIn ?? "—"}
                </p>
                <p>
                  <span className="text-slate-500">Odchod:</span>{" "}
                  {todaySummary.checkOut ?? "—"}
                </p>
                <p>
                  <span className="text-slate-500">Odpracováno:</span>{" "}
                  {todaySummary.hoursWorked != null
                    ? `${todaySummary.hoursWorked} h`
                    : "—"}
                </p>
                <p>
                  <span className="text-slate-500">Stav:</span>{" "}
                  {todaySummary.statusLabel}
                </p>
              </>
            ) : (
              <p className="text-slate-500">{t("noAttendanceToday")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
