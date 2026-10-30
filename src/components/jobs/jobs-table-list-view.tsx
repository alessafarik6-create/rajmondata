"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { JobListRow } from "@/lib/job-list-filters";
import { formatJobListDate, resolveJobDeadlineDisplay } from "@/lib/job-list-filters";
import { resolveJobDisplayNumber } from "@/lib/jobs/job-timeline-utils";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Props = {
  jobs: JobListRow[];
  getCustomerName: (id: string | undefined | null) => string;
  isPortalEmployee?: boolean;
  dark?: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (jobId: string) => void;
};

export function JobsTableListView({
  jobs,
  getCustomerName,
  isPortalEmployee = false,
  dark = false,
  selectable = false,
  selectedIds,
  onToggleSelect,
}: Props) {
  const router = useRouter();
  const href = (id: string) =>
    isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`;

  return (
    <div className="overflow-x-auto px-3 py-4 sm:px-4">
      <table
        className={cn(
          "min-w-full text-sm",
          dark ? "text-slate-100" : "text-slate-900"
        )}
      >
        <thead
          className={cn(
            "text-left text-xs uppercase tracking-wide",
            dark ? "bg-slate-900 text-slate-400" : "bg-slate-50 text-slate-600"
          )}
        >
          <tr>
            {selectable ? <th className="p-2 w-8" /> : null}
            <th className="p-2">Číslo</th>
            <th className="p-2">Název</th>
            <th className="p-2">Založeno</th>
            <th className="p-2">Zákazník</th>
            <th className="p-2">Termín</th>
            <th className="p-2">Stav</th>
            <th className="p-2">Akce</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const id = String(job.id ?? "");
            const deadline = resolveJobDeadlineDisplay(job);
            return (
              <tr
                key={id || job.name}
                className={cn(
                  "border-t cursor-pointer hover:bg-slate-50/80",
                  dark && "border-white/10 hover:bg-slate-800/60"
                )}
                onClick={() => id && router.push(href(id))}
              >
                {selectable && id ? (
                  <td className="p-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds?.has(id) ?? false}
                      onCheckedChange={() => onToggleSelect?.(id)}
                      aria-label="Vybrat zakázku"
                    />
                  </td>
                ) : selectable ? (
                  <td className="p-2" />
                ) : null}
                <td className="p-2 font-mono text-xs whitespace-nowrap">
                  {resolveJobDisplayNumber(job) || "—"}
                </td>
                <td className="p-2 font-medium max-w-[14rem] truncate" title={job.name}>
                  {job.name ?? "—"}
                </td>
                <td className="p-2 whitespace-nowrap text-xs">
                  {formatJobListDate(job.createdAt)}
                </td>
                <td className="p-2 max-w-[12rem] truncate">
                  {getCustomerName(job.customerId)}
                </td>
                <td className="p-2 whitespace-nowrap text-xs">
                  {deadline.hasDeadline ? deadline.endLabel : "Bez termínu"}
                </td>
                <td className="p-2">
                  <JobStatusBadge status={job.status} compact dark={dark} />
                </td>
                <td className="p-2" onClick={(e) => e.stopPropagation()}>
                  {id ? (
                    <Link
                      href={href(id)}
                      className="text-orange-600 hover:underline text-xs font-medium"
                    >
                      Detail
                    </Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
