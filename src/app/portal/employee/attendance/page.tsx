"use client";

import React, { useMemo } from "react";
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
import { Info } from "lucide-react";
import { summarizeAttendanceByDay } from "@/lib/employee-attendance";

export default function EmployeeAttendancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { companyName } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc<any>(userRef);
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

  const { data: rawRows = [], isLoading } = useCollection(attendanceQuery);

  const summaries = useMemo(() => {
    return summarizeAttendanceByDay(rawRows as any[], {
      employeeId,
      authUid: user?.uid,
    });
  }, [rawRows, employeeId, user?.uid]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Moje docházka</h1>
        <p className="portal-page-description">
          Pouze pro čtení. Úpravy záznamů provádí administrátor.
          {companyName ? ` · ${companyName}` : ""}
        </p>
      </div>

      <Alert className="bg-amber-50 border-amber-200 text-amber-950">
        <Info className="h-4 w-4" />
        <AlertTitle>Čtení pouze</AlertTitle>
        <AlertDescription>
          Zde vidíte jen svou docházku. Nemůžete přidávat příchody ani odchody.
        </AlertDescription>
      </Alert>

      <Card className="bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle>Přehled po dnech</CardTitle>
          <CardDescription>
            Datum, příchod, odchod, odpracované hodiny a stav dne.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500">Načítání…</p>
          ) : summaries.length === 0 ? (
            <p className="text-sm text-slate-500">
              Zatím nemáte žádné záznamy docházky.
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
                      {s.statusLabel}
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
