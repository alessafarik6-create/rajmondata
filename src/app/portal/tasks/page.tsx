"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useCompany,
  useCollection,
  useDoc,
  useFirestore,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { collection, doc } from "firebase/firestore";
import { DashboardJobTasksWidget } from "@/components/jobs/dashboard-job-tasks-widget";
import { OrganizationTasksDialog } from "@/components/tasks/organization-tasks-dialog";
import { useIsBelowLg } from "@/hooks/use-mobile";

type JobRow = { id?: string; name?: string };

export default function PortalTasksPage() {
  const belowLg = useIsBelowLg();
  const firestore = useFirestore();
  const { user } = useUser();
  const { companyId } = useCompany();
  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc(userRef);

  const canManageTasks =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "accountant" ||
    profile?.globalRoles?.includes("super_admin");

  const [tasksDialogOpen, setTasksDialogOpen] = useState(false);
  const [tasksDialogStartCreate, setTasksDialogStartCreate] = useState(false);

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
        "min-h-[100dvh] pb-[calc(96px+env(safe-area-inset-bottom))]",
        belowLg ? "px-0 pt-3" : "px-4 pt-4 sm:px-6"
      )}
    >
      <div
        className={cn(
          "mx-auto w-full space-y-4",
          belowLg ? "max-w-none px-4" : "max-w-3xl"
        )}
      >
        {belowLg ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button
                asChild
                variant="outline"
                className="h-9 min-h-[36px] shrink-0 rounded-lg border-white/20 bg-white/5 px-3 text-xs text-slate-100 hover:bg-white/10"
              >
                <Link href="/portal/dashboard">
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  Zpět
                </Link>
              </Button>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <ListTodo className="h-5 w-5 shrink-0 text-orange-300" aria-hidden />
                <h1 className="truncate text-lg font-semibold text-white">Úkoly</h1>
              </div>
            </div>
            {canManageTasks && companyId ? (
              <Button
                type="button"
                className="h-9 w-fit min-h-[36px] shrink-0 rounded-lg border-0 bg-orange-600 px-3 text-xs font-medium text-white hover:bg-orange-500"
                onClick={() => {
                  setTasksDialogStartCreate(true);
                  setTasksDialogOpen(true);
                }}
              >
                Nový úkol
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <ListTodo className="h-5 w-5 shrink-0 text-orange-500" aria-hidden />
              <h1 className="truncate text-lg font-semibold text-foreground">Úkoly</h1>
            </div>
            <Button asChild variant="outline" className="min-h-11 shrink-0 px-4">
              <Link href="/portal/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zpět
              </Link>
            </Button>
          </div>
        )}

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

        {companyId && user ? (
          <OrganizationTasksDialog
            open={tasksDialogOpen}
            onOpenChange={(o) => {
              setTasksDialogOpen(o);
              if (!o) setTasksDialogStartCreate(false);
            }}
            companyId={companyId}
            canManage={!!canManageTasks}
            employeeId={profile?.employeeId as string | undefined}
            startInCreateMode={tasksDialogStartCreate}
          />
        ) : null}
      </div>
    </div>
  );
}

