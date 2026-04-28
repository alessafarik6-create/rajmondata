"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCompany, useCollection, useFirestore, useMemoFirebase } from "@/firebase";
import { collection } from "firebase/firestore";
import { DashboardJobTasksWidget } from "@/components/jobs/dashboard-job-tasks-widget";
import { useIsBelowLg } from "@/hooks/use-mobile";

type JobRow = { id?: string; name?: string };

export default function PortalTasksPage() {
  const belowLg = useIsBelowLg();
  const firestore = useFirestore();
  const { companyId } = useCompany();

  const jobsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "jobs");
  }, [firestore, companyId]);

  const { data: jobsRaw = [], isLoading: jobsLoading } = useCollection<any>(jobsQuery);
  const jobs = useMemo(() => {
    const list = Array.isArray(jobsRaw) ? (jobsRaw as JobRow[]) : [];
    return list
      .map((j) => ({ id: String(j?.id ?? "").trim(), name: j?.name }))
      .filter((j) => Boolean(j.id));
  }, [jobsRaw]);

  const todayIso = useMemo(() => new Date().toISOString().split("T")[0], []);

  return (
    <div
      className={cn(
        belowLg ? "bg-slate-950 text-slate-50" : "bg-background text-foreground",
        "min-h-[100dvh] px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6"
      )}
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ListTodo className="h-5 w-5 text-orange-300 shrink-0" aria-hidden />
            <h1 className="truncate text-lg font-semibold text-white">Úkoly</h1>
          </div>
          <Button
            asChild
            variant="outline"
            className="min-h-11 border-white/20 bg-white/5 px-4 text-slate-100 hover:bg-white/10"
          >
            <Link href="/portal/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zpět
            </Link>
          </Button>
        </div>

        {companyId ? (
          <DashboardJobTasksWidget
            companyId={companyId}
            todayIso={todayIso}
            jobs={jobs}
            jobsLoading={jobsLoading}
            variant={belowLg ? "mobile" : "desktop"}
          />
        ) : (
          <p className="text-sm text-slate-300">Není vybraná organizace.</p>
        )}
      </div>
    </div>
  );
}

