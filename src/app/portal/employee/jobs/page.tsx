"use client";

import React from "react";
import Link from "next/link";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
} from "@/firebase";
import { doc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Briefcase } from "lucide-react";
import { useAssignedWorklogJobs } from "@/hooks/use-assigned-worklog-jobs";

export default function EmployeeJobsListPage() {
  const { user } = useUser();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;
  const employeeId = profile?.employeeId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc, isLoading: employeeLoading } = useDoc(employeeRef);

  const { jobs, jobsLoading } = useAssignedWorklogJobs(
    firestore,
    companyId,
    employeeDoc as Record<string, unknown> | undefined,
    employeeLoading,
    user?.uid,
    employeeId,
    "employeeSummary"
  );

  const loading =
    !user || profileLoading || (companyId && employeeId && employeeLoading);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Načítání zakázek…</p>
      </div>
    );
  }

  if (!profile || !companyId || !employeeId) {
    return (
      <Card className="max-w-lg">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Nelze načíst přiřazené zakázky. Zkontrolujte propojení účtu se zaměstnancem.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-3 py-6 sm:px-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/employee" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Přehled
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Briefcase className="h-6 w-6 text-primary" />
            Moje zakázky
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Zobrazují se jen zakázky, ke kterým máte přístup. V detailu najdete
            fotodokumentaci podle oprávnění.
          </p>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítám zakázky…
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                Zatím nemáte přiřazenou žádnou zakázku.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Až vás administrátor přiřadí k zakázce, objeví se zde a uvidíte
                povolenou fotodokumentaci.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link
                    href={`/portal/employee/jobs/${j.id}`}
                    className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="font-medium text-foreground">
                      {j.name?.trim() ? j.name.trim() : "Zakázka nenalezena"}
                    </span>
                    <span className="text-xs text-muted-foreground">Otevřít</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
