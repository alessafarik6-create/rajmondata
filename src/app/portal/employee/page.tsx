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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  summarizeAttendanceByDay,
  sumHoursTodayAndWeek,
} from "@/lib/employee-attendance";
import { Calendar, Clock } from "lucide-react";

export default function EmployeeHomePage() {
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
      return query(base, where("employeeId", "==", ids[0]), limit(400));
    }
    return query(base, where("employeeId", "in", ids), limit(400));
  }, [firestore, companyId, employeeId, user]);

  const { data: rawRows = [] } = useCollection(attendanceQuery);

  const summaries = useMemo(() => {
    return summarizeAttendanceByDay(rawRows as any[], {
      employeeId,
      authUid: user?.uid,
    });
  }, [rawRows, employeeId, user?.uid]);

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

  return (
    <div className="space-y-6 sm:space-y-8 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <Avatar className="h-24 w-24 border-4 border-primary/20 shrink-0">
          <AvatarImage src={photoUrl || undefined} alt="" className="object-cover" />
          <AvatarFallback className="text-2xl bg-primary text-white">
            {displayName[0]?.toUpperCase() || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Dobrý den, {profile?.firstName || displayName.split(" ")[0] || "kolego"}!
          </h1>
          <p className="portal-page-description mt-1">
            {profile?.jobTitle ? (
              <span className="font-semibold text-slate-800">
                {profile.jobTitle}
              </span>
            ) : (
              <span>Pracovní pozice není vyplněná.</span>
            )}
            {companyName ? (
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
            <div className="flex justify-between">
              <span>Dnes</span>
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
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Přehled dne ({todayIso})
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-700 space-y-1">
            {todaySummary ? (
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
              <p className="text-slate-500">
                Pro dnešek nemáte v docházce žádné záznamy.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
