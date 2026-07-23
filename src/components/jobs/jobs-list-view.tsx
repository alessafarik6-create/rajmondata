"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  CheckCircle2,
} from "lucide-react";
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

const thClass =
  "h-10 px-2 text-left align-middle text-xs font-semibold text-slate-700 first:pl-3 last:pr-3 sm:first:pl-4 sm:last:pr-4";
const tdClass =
  "px-2 py-2.5 align-middle text-sm first:pl-3 last:pr-3 sm:first:pl-4 sm:last:pr-4";

function JobDeadlineCompact({
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
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1 text-xs font-medium text-emerald-800",
          dark && "text-emerald-300"
        )}
        title={
          completedTs
            ? `Dokončeno ${formatJobListDate(completedTs)}`
            : "Dokončená zakázka"
        }
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {completedTs ? formatJobListDate(completedTs) : "Dokončeno"}
        </span>
      </span>
    );
  }

  if (!deadline.hasDeadline) {
    return (
      <span className={cn("text-xs text-slate-500", dark && "text-slate-400")}>
        Bez termínu
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-xs",
        deadlineUrgencyTextClass(deadline.urgency, false),
        dark && deadline.urgency === "overdue" && "text-red-300",
        dark && deadline.urgency === "soon" && "text-orange-300"
      )}
      title={`Termín do ${deadline.endLabel}`}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{deadline.endLabel}</span>
    </span>
  );
}

export function JobsListView({
  jobs,
  getCustomerName,
  getCustomerAddress,
  isPortalEmployee = false,
  dark = false,
}: JobsListViewProps) {
  const router = useRouter();

  const jobDetailHref = (id: string) =>
    isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`;

  const openJobDetail = (id: string | undefined) => {
    if (!id) return;
    router.push(jobDetailHref(id));
  };

  if (dark) {
    return (
      <div className="space-y-1.5 bg-slate-950 p-2">
        {jobs.map((job) => {
          const jid = job?.id;
          const href = jid ? jobDetailHref(jid) : "#";
          const addr = getCustomerAddress?.(job?.customerId);
          const deadline = resolveJobDeadlineDisplay(job);
          const completed = isCompletedJobStatus(job.status);
          const customerName = getCustomerName(job?.customerId);

          return (
            <div
              key={jid ?? `job-${job?.name}`}
              role={jid ? "button" : undefined}
              tabIndex={jid ? 0 : undefined}
              onClick={() => openJobDetail(jid)}
              onKeyDown={(e) => {
                if (jid && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  openJobDetail(jid);
                }
              }}
              className={cn(
                "cursor-pointer rounded-lg border border-white/10 px-2.5 py-2 transition-colors active:opacity-90",
                completed
                  ? "border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-950/30"
                  : "bg-slate-900/90 hover:bg-slate-800/90"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-semibold leading-tight text-white"
                    title={String(job?.name ?? "")}
                  >
                    {job?.name ?? "—"}
                  </p>
                  {job?.description ? (
                    <p
                      className="mt-0.5 line-clamp-1 text-[12px] text-slate-400"
                      title={job.description}
                    >
                      {job.description}
                    </p>
                  ) : null}
                  <p
                    className="mt-1 truncate text-[12px] text-slate-200"
                    title={customerName}
                  >
                    {customerName}
                  </p>
                  {addr ? (
                    <p
                      className="mt-0.5 line-clamp-1 text-[11px] text-slate-400"
                      title={addr}
                    >
                      {addr}
                    </p>
                  ) : null}
                </div>
                <JobStatusBadge status={job?.status} compact dark />
              </div>

              <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 text-[12px]">
                <div className="min-w-0">
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
                {jid ? (
                  <Button
                    asChild
                    size="sm"
                    className="pointer-events-auto h-8 shrink-0 rounded-md bg-orange-500 px-3 text-[12px] font-semibold text-slate-950 hover:bg-orange-400"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={href}>Detail</Link>
                  </Button>
                ) : null}
              </div>

              {job?.jobTag && String(job.jobTag).trim() ? (
                <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <Badge
                    variant="secondary"
                    className="max-w-full truncate border-white/10 bg-slate-800 text-[11px] text-slate-200"
                  >
                    {jobTagLabel(job.jobTag)}
                  </Badge>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <table className="w-full min-w-0 table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            <th className={cn(thClass)}>Zakázka</th>
            <th className={cn(thClass, "hidden md:table-cell w-[17%]")}>
              Zákazník
            </th>
            <th className={cn(thClass, "hidden w-[9%] lg:table-cell")}>Typ</th>
            <th className={cn(thClass, "w-[108px]")}>Stav</th>
            <th className={cn(thClass, "hidden w-[96px] sm:table-cell")}>
              Termín
            </th>
            <th className={cn(thClass, "hidden w-[88px] xl:table-cell")}>
              Poslední aktivita
            </th>
            <th className={cn(thClass, "w-16 text-right")}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const jid = job?.id;
            const completed = isCompletedJobStatus(job.status);
            const customerName = getCustomerName(job?.customerId);
            const jobName = String(job?.name ?? "—");
            const jobDesc = String(job?.description ?? "").trim();
            const href = jid ? jobDetailHref(jid) : "#";

            return (
              <tr
                key={jid ?? `job-${job?.name}`}
                tabIndex={jid ? 0 : undefined}
                onClick={() => openJobDetail(jid)}
                onKeyDown={(e) => {
                  if (jid && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    openJobDetail(jid);
                  }
                }}
                className={cn(
                  "cursor-pointer border-b border-slate-200 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary",
                  completed
                    ? cn(
                        jobStatusRowClassName(job.status),
                        "hover:bg-emerald-100/90"
                      )
                    : "hover:bg-slate-100"
                )}
              >
                <td className={tdClass}>
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold text-slate-900"
                      title={jobName}
                    >
                      {jobName}
                    </p>
                    {jobDesc ? (
                      <p
                        className="mt-0.5 line-clamp-1 text-xs text-slate-500"
                        title={jobDesc}
                      >
                        {jobDesc}
                      </p>
                    ) : null}
                    <p
                      className="mt-0.5 truncate text-xs text-slate-600 md:hidden"
                      title={customerName}
                    >
                      {customerName}
                    </p>
                    <div className="mt-0.5 sm:hidden">
                      <JobDeadlineCompact job={job} />
                    </div>
                  </div>
                </td>
                <td className={cn(tdClass, "hidden md:table-cell")}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Building2
                      className="h-3.5 w-3.5 shrink-0 text-slate-400"
                      aria-hidden
                    />
                    <span className="truncate text-sm text-slate-700" title={customerName}>
                      {customerName}
                    </span>
                  </div>
                </td>
                <td className={cn(tdClass, "hidden lg:table-cell")}>
                  {job?.jobTag && String(job.jobTag).trim() ? (
                    <Badge
                      variant="secondary"
                      className="max-w-full truncate text-[11px] font-normal"
                      title={jobTagLabel(job.jobTag)}
                    >
                      {jobTagLabel(job.jobTag)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className={tdClass}>
                  <JobStatusBadge status={job?.status} />
                </td>
                <td className={cn(tdClass, "hidden sm:table-cell")}>
                  <JobDeadlineCompact job={job} />
                </td>
                <td
                  className={cn(
                    tdClass,
                    "hidden text-xs text-slate-600 xl:table-cell"
                  )}
                  title={formatRelativeActivityLabel(job)}
                >
                  <span className="line-clamp-2 break-words">
                    {formatRelativeActivityLabel(job)}
                  </span>
                </td>
                <td className={cn(tdClass, "text-right")}>
                  {jid ? (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-[12px] font-semibold text-slate-800 hover:bg-white"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link href={href} title="Detail zakázky">
                        Detail
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
