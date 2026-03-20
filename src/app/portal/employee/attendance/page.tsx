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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info, Loader2, AlertCircle } from "lucide-react";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";

const DEBUG = process.env.NODE_ENV === "development";

export default function EmployeeAttendancePage() {
  const pathname = usePathname();
  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { companyName, isLoading: companyLoading } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading, error: profileError } =
    useDoc<any>(userRef);

  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const attendanceQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !user) return null;
    const ids = [...new Set([employeeId, user.uid].filter(Boolean))] as string[];
    if (ids.length === 0) return null;
    const base = collection(firestore, "companies", companyId, "attendance");
    if (ids.length === 1) {
      return query(base, where("employeeId", "==", ids[0]), limit(500));
    }
    return query(base, where("employeeId", "in", ids), limit(500));
  }, [firestore, companyId, employeeId, user]);

  const {
    data: rawRows,
    isLoading: attendanceLoading,
    error: attendanceError,
  } = useCollection(attendanceQuery);

  /** useCollection vrací data: null — default `= []` v destructuringu neplatí pro null! */
  const rowsSafe = Array.isArray(rawRows) ? rawRows : [];

  const summaries = useMemo(() => {
    try {
      return summarizeAttendanceByDay(rowsSafe as any[], {
        employeeId,
        authUid: user?.uid,
      });
    } catch (e) {
      console.error("[employee/attendance] summarizeAttendanceByDay", e);
      return [];
    }
  }, [rowsSafe, employeeId, user?.uid]);

  useEffect(() => {
    if (!DEBUG) return;
    console.log("[employee/attendance]", {
      route: pathname,
      userUid: user?.uid ?? null,
      employeeProfile: profile
        ? { id: profile.id, employeeId: profile.employeeId, companyId: profile.companyId }
        : null,
      role: profile?.role ?? null,
      companyId: companyId ?? null,
      employeeId: employeeId ?? null,
      profileLoading,
      attendanceLoading,
      companyLoading,
      rawRowsCount: rowsSafe.length,
      rawSample: rowsSafe.slice(0, 3),
      summariesCount: summaries.length,
      transformedSample: summaries.slice(0, 3),
      profileError: profileError?.message ?? null,
      attendanceError: attendanceError?.message ?? null,
    });
  }, [
    pathname,
    user?.uid,
    profile,
    companyId,
    employeeId,
    profileLoading,
    attendanceLoading,
    companyLoading,
    rowsSafe,
    summaries,
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

  if (profileLoading) {
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
          Kontaktujte administrátora. Bez profilu nelze zobrazit docházku.
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
          V profilu není <code className="text-xs">companyId</code>. Docházku
          nelze načíst.
        </AlertDescription>
      </Alert>
    );
  }

  if (profileError) {
    return (
      <Alert variant="destructive" className="max-w-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Chyba profilu</AlertTitle>
        <AlertDescription>
          {profileError.message || "Zkuste obnovit stránku."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Moje docházka</h1>
        <p className="portal-page-description">
          Pouze pro čtení. Úpravy záznamů provádí administrátor.
          {companyName && companyName !== "Organization"
            ? ` · ${companyName}`
            : ""}
        </p>
      </div>

      <Alert className="bg-amber-50 border-amber-200 text-amber-950">
        <Info className="h-4 w-4" />
        <AlertTitle>Čtení pouze</AlertTitle>
        <AlertDescription>
          Zde vidíte jen svou docházku. Nemůžete přidávat příchody ani odchody.
        </AlertDescription>
      </Alert>

      {attendanceError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Docházku nelze načíst</AlertTitle>
          <AlertDescription>
            {attendanceError.message ||
              "Zkontrolujte oprávnění nebo připojení k síti."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Přehled po dnech</CardTitle>
          <CardDescription>
            Datum, příchod, odchod, odpracované hodiny a stav dne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attendanceLoading ? (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Načítání…
            </p>
          ) : summaries.length === 0 ? (
            <p className="text-sm text-slate-500">
              Zatím nejsou dostupné žádné záznamy docházky.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Příchod</TableHead>
                  <TableHead>Odchod</TableHead>
                  <TableHead>Hodiny</TableHead>
                  <TableHead>Stav</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((s) => (
                  <TableRow key={s.date}>
                    <TableCell className="font-medium">{s.date}</TableCell>
                    <TableCell>{s.checkIn ?? "—"}</TableCell>
                    <TableCell>{s.checkOut ?? "—"}</TableCell>
                    <TableCell>
                      {s.hoursWorked != null ? `${s.hoursWorked} h` : "—"}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {s.statusLabel ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
