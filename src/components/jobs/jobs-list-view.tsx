"use client";

import React from "react";
import Link from "next/link";
import {
  Building2,
  Calendar,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { jobTagLabel } from "@/lib/job-tags";
import {
  deadlineUrgencyTextClass,
  formatJobListDate,
  formatRelativeActivityLabel,
  jobCompletedTimestamp,
  resolveJobDeadlineDisplay,
  type JobListRow,
} from "@/lib/job-list-filters";
import { isCompletedJobStatus } from "@/lib/job-status";
import {
  JobStatusBadge,
  jobStatusRowClassName,
} from "@/components/jobs/job-status-badge";

type JobsListViewProps = {
  jobs: JobListRow[];
  getCustomerName: (customerId: string | undefined | null) => string;
  getCustomerAddress?: (customerId: string | undefined | null) => string;
  isPortalEmployee?: boolean;
  isAdmin?: boolean;
  dark?: boolean;
};

function JobDeadlineCell({
  job,
  dark,
}: {
  job: JobListRow;
  dark?: boolean;
}) {
  const completed = isCompletedJobStatus(job.status);
  const deadline = resolveJobDeadlineDisplay(job);
  const completedTs = jobCompletedTimestamp(job);

  if (completed) {
    return (
      <div className="space-y-1 text-xs">
        <div
          className={cn(
            "inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300",
            dark && "text-emerald-300"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Dokončeno{" "}
          {completedTs ? formatJobListDate(completedTs) : "—"}
        </div>
        {job.completedByName ? (
          <p className={cn("text-muted-foreground", dark && "text-slate-400")}>
            {job.completedByName}
          </p>
        ) : null}
        {deadline.startLabel !== "—" ? (
          <p className={cn("text-muted-foreground", dark && "text-slate-500")}>
            Plán: {deadline.startLabel} – {deadline.endLabel}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-0.5 text-xs">
      {deadline.hasDeadline ? (
        <>
          {deadline.startLabel !== "—" ? (
            <p className={cn("text-muted-foreground", dark && "text-slate-400")}>
              Od: {deadline.startLabel}
            </p>
          ) : null}
          <p
            className={cn(
              "flex items-center gap-1",
              deadlineUrgencyTextClass(deadline.urgency, false),
              dark &&
                deadline.urgency === "overdue" &&
                "text-red-300",
              dark &&
                deadline.urgency === "soon" &&
                "text-orange-300"
            )}
          >
            <Calendar className="h-3 w-3 shrink-0" aria-hidden />
            Do: {deadline.endLabel}
          </p>
        </>
      ) : (
        <p className={cn("text-muted-foreground", dark && "text-slate-400")}>
          Bez termínu
        </p>
      )}
    </div>
  );
}

export function JobsListView({
  jobs,
  getCustomerName,
  getCustomerAddress,
  isPortalEmployee = false,
  isAdmin = false,
  dark = false,
}: JobsListViewProps) {
  const jobDetailHref = (id: string) =>
    isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`;

  if (dark) {
    return (
      <div className="space-y-1.5 bg-slate-950 p-2">
        {jobs.map((job) => {
          const jid = job?.id;
          const addr = getCustomerAddress?.(job?.customerId);
          const deadline = resolveJobDeadlineDisplay(job);
          const completed = isCompletedJobStatus(job.status);

          return (
            <div
              key={jid ?? `job-${job?.name}`}
              className={cn(
                "rounded-lg border border-white/10 px-2.5 py-2",
                completed
                  ? "border-emerald-500/20 bg-emerald-950/20"
                  : "bg-slate-900/90"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight text-white">
                    {job?.name ?? "—"}
                  </p>
                  {job?.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">
                      {job.description}
                    </p>
                  ) : null}
                  <p className="mt-1 truncate text-[11px] text-slate-200">
                    {getCustomerName(job?.customerId)}
                  </p>
                  {addr ? (
                    <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-400">
                      {addr}
                    </p>
                  ) : null}
                </div>
                <JobStatusBadge status={job?.status} compact dark />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                <div>
                  <span className="text-slate-400">Termín </span>
                  <span
                    className={cn(
                      "font-medium",
                      completed
                        ? "text-slate-400"
                        : deadline.urgency === "overdue"
                          ? "text-red-300"
                          : deadline.urgency === "soon"
                            ? "text-orange-300"
                            : "text-slate-100"
                    )}
                  >
                    {completed
                      ? formatJobListDate(jobCompletedTimestamp(job))
                      : deadline.primaryLabel}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400">Aktivita </span>
                  <span className="font-medium text-slate-100">
                    {formatRelativeActivityLabel(job)}
                  </span>
                </div>
              </div>

              {job?.jobTag && String(job.jobTag).trim() ? (
                <div className="mt-1.5">
                  <Badge
                    variant="secondary"
                    className="max-w-full truncate border-white/10 bg-slate-800 text-[10px] text-slate-200"
                  >
                    {jobTagLabel(job.jobTag)}
                  </Badge>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                {jid ? (
                  <Button
                    asChild
                    className="h-8 min-h-8 rounded-md bg-orange-500 px-3 text-xs text-slate-950 hover:bg-orange-400"
                  >
                    <Link href={jobDetailHref(jid)}>Detail</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Table className="min-w-[920px] w-full">
      <TableHeader>
        <TableRow className="border-slate-200 hover:bg-transparent">
          <TableHead className="min-w-[220px] pl-4 sm:pl-6">Zakázka</TableHead>
          <TableHead className="hidden md:table-cell min-w-[140px]">
            Zákazník
          </TableHead>
          <TableHead className="hidden lg:table-cell min-w-[120px]">
            Typ / štítek
          </TableHead>
          <TableHead className="min-w-[120px]">Stav</TableHead>
          <TableHead className="hidden sm:table-cell min-w-[130px]">
            Termín
          </TableHead>
          <TableHead className="hidden xl:table-cell min-w-[110px]">
            Poslední aktivita
          </TableHead>
          <TableHead className="pr-4 sm:pr-6 text-right min-w-[90px]">
            Akce
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const jid = job?.id;
          const completed = isCompletedJobStatus(job.status);
          return (
            <TableRow
              key={jid ?? `job-${job?.name}`}
              className={cn(
                "border-slate-200",
                completed
                  ? jobStatusRowClassName(job.status)
                  : "hover:bg-slate-50"
              )}
            >
              <TableCell className="pl-4 sm:pl-6">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {job?.name ?? "—"}
                  </span>
                  {job?.description ? (
                    <span className="line-clamp-2 max-w-md text-xs text-slate-500">
                      {job.description}
                    </span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell text-slate-700">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Building2
                    className="h-3.5 w-3.5 shrink-0 text-slate-400"
                    aria-hidden
                  />
                  <span className="truncate">
                    {getCustomerName(job?.customerId)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {job?.jobTag && String(job.jobTag).trim() ? (
                  <Badge
                    variant="secondary"
                    className="max-w-[10rem] truncate text-xs font-normal"
                    title={jobTagLabel(job.jobTag)}
                  >
                    {jobTagLabel(job.jobTag)}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <JobStatusBadge status={job?.status} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <JobDeadlineCell job={job} />
              </TableCell>
              <TableCell className="hidden xl:table-cell text-xs text-slate-600">
                {formatRelativeActivityLabel(job)}
              </TableCell>
              <TableCell className="pr-4 sm:pr-6 text-right">
                {jid ? (
                  <Button asChild variant="ghost" size="sm" className="text-slate-700">
                    <Link href={jobDetailHref(jid)}>
                      <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Detail
                    </Link>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
