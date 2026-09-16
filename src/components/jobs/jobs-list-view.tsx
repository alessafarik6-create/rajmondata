"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  collectJobTagFilterOptions,
  jobTagLabel,
} from "@/lib/job-tags";
import { normalizeCompletionPercent } from "@/lib/job-customer-progress";
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

const UNTAGGED_KEY = "";

export type JobTagColumn = {
  tagKey: string;
  label: string;
  jobs: JobListRow[];
};

/** Seskupení podle pole `jobTag` (sloupec Typ v původní tabulce). */
export function groupJobsByTagColumns(jobs: JobListRow[]): JobTagColumn[] {
  const buckets = new Map<string, JobListRow[]>();
  for (const j of jobs) {
    const k = String(j.jobTag ?? "").trim() || UNTAGGED_KEY;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(j);
  }

  const orderedKeys: string[] = [];
  for (const opt of collectJobTagFilterOptions(jobs)) {
    const list = buckets.get(opt.value);
    if (list && list.length > 0) orderedKeys.push(opt.value);
  }
  for (const [k, list] of buckets) {
    if (list.length > 0 && !orderedKeys.includes(k)) orderedKeys.push(k);
  }
  if (
    buckets.has(UNTAGGED_KEY) &&
    (buckets.get(UNTAGGED_KEY)?.length ?? 0) > 0 &&
    !orderedKeys.includes(UNTAGGED_KEY)
  ) {
    orderedKeys.push(UNTAGGED_KEY);
  }

  return orderedKeys.map((tagKey) => ({
    tagKey,
    label: tagKey === UNTAGGED_KEY ? "Bez typu" : jobTagLabel(tagKey),
    jobs: buckets.get(tagKey) ?? [],
  }));
}

function columnHeadingLabel(label: string): string {
  return label.toLocaleUpperCase("cs-CZ");
}

function zakazkyCountLabel(n: number): string {
  if (n === 1) return "1 zakázka";
  if (n >= 2 && n <= 4) return `${n} zakázky`;
  return `${n} zakázek`;
}

function jobCompletionPercent(job: JobListRow): number {
  return normalizeCompletionPercent(
    (job as { completionPercent?: unknown }).completionPercent
  );
}

function JobDeadlineBlock({
  job,
  dark,
  compact,
}: {
  job: JobListRow;
  dark?: boolean;
  compact?: boolean;
}) {
  const completed = isCompletedJobStatus(job.status);
  const deadline = resolveJobDeadlineDisplay(job);
  const completedTs = jobCompletedTimestamp(job);

  if (completed) {
    return (
      <div className={cn("text-xs", compact && "space-y-0.5")}>
        <span className={cn("text-slate-500", dark && "text-slate-400")}>Termín</span>
        <div
          className={cn(
            "inline-flex min-w-0 items-center gap-1 font-medium text-emerald-800",
            dark && "text-emerald-300"
          )}
        >
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{completedTs ? formatJobListDate(completedTs) : "Dokončeno"}</span>
        </div>
      </div>
    );
  }

  if (!deadline.hasDeadline) {
    return (
      <div className={cn("text-xs", compact && "space-y-0.5")}>
        <span className={cn("text-slate-500", dark && "text-slate-400")}>Termín</span>
        <p className={cn("text-slate-500", dark && "text-slate-400")}>Bez termínu</p>
      </div>
    );
  }

  const overdue = deadline.urgency === "overdue";

  return (
    <div className={cn("text-xs", compact && "space-y-0.5")}>
      <span className={cn("text-slate-500", dark && "text-slate-400")}>Termín</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            deadlineUrgencyTextClass(deadline.urgency, false),
            dark && deadline.urgency === "overdue" && "text-red-300",
            dark && deadline.urgency === "soon" && "text-orange-300"
          )}
        >
          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {deadline.endLabel}
        </span>
        {overdue ? (
          <Badge
            variant="outline"
            className={cn(
              "h-5 border-red-200 bg-red-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-700",
              dark && "border-red-500/40 bg-red-950/50 text-red-300"
            )}
          >
            Po termínu
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function JobListCard({
  job,
  customerName,
  href,
  onOpen,
  dark,
}: {
  job: JobListRow;
  customerName: string;
  href: string;
  onOpen: () => void;
  dark?: boolean;
}) {
  const jid = job?.id;
  const completed = isCompletedJobStatus(job.status);
  const jobName = String(job?.name ?? "—");
  const pct = jobCompletionPercent(job);
  const activity = formatRelativeActivityLabel(job);

  return (
    <article
      role={jid ? "button" : undefined}
      tabIndex={jid ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (jid && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "cursor-pointer rounded-lg border p-3 text-left shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        dark
          ? cn(
              "border-white/10 bg-slate-900/90 hover:bg-slate-800/90",
              completed && "border-emerald-500/20 bg-emerald-950/20"
            )
          : cn(
              "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80",
              completed && jobStatusRowClassName(job.status)
            )
      )}
    >
      <h3
        className={cn(
          "text-sm font-semibold leading-snug text-slate-900 line-clamp-3",
          dark && "text-white"
        )}
        title={jobName}
      >
        {jobName}
      </h3>

      <div className="mt-2 space-y-1.5 text-xs">
        <div>
          <span className={cn("text-slate-500", dark && "text-slate-400")}>Zákazník</span>
          <p
            className={cn(
              "truncate font-medium text-slate-800",
              dark && "text-slate-100"
            )}
            title={customerName}
          >
            {customerName}
          </p>
        </div>
        <div>
          <span className={cn("text-slate-500", dark && "text-slate-400")}>Stav</span>
          <div className="mt-0.5">
            <JobStatusBadge status={job?.status} compact={dark} dark={dark} />
          </div>
        </div>
        <JobDeadlineBlock job={job} dark={dark} compact />
        {pct > 0 ? (
          <div className="pt-0.5">
            <div className="mb-1 flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
              <span>Dokončení</span>
              <span className="tabular-nums font-medium">{pct} %</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        ) : null}
        {activity && activity !== "—" ? (
          <p
            className={cn(
              "pt-0.5 text-[11px] text-slate-500 line-clamp-2",
              dark && "text-slate-400"
            )}
            title={activity}
          >
            {activity}
          </p>
        ) : null}
      </div>

      {jid ? (
        <div className="mt-2.5 flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button
            asChild
            variant={dark ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-[12px] font-semibold",
              dark &&
                "rounded-md bg-orange-500 px-3 text-slate-950 hover:bg-orange-400",
              !dark && "border-slate-300 text-slate-800"
            )}
          >
            <Link href={href}>Detail</Link>
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function MobileTagSection({
  column,
  dark,
  jobDetailHref,
  openJobDetail,
  getCustomerName,
  defaultOpen,
}: {
  column: JobTagColumn;
  dark?: boolean;
  jobDetailHref: (id: string) => string;
  openJobDetail: (id: string | undefined) => void;
  getCustomerName: (customerId: string | undefined | null) => string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left",
          dark
            ? "border-white/10 bg-slate-900/80 text-slate-100"
            : "border-slate-200 bg-slate-50 text-slate-900"
        )}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-wide">
            {columnHeadingLabel(column.label)}
          </p>
          <p className={cn("text-xs", dark ? "text-slate-400" : "text-slate-600")}>
            {zakazkyCountLabel(column.jobs.length)}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform",
            open && "rotate-180",
            dark ? "text-slate-400" : "text-slate-500"
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        {column.jobs.map((job) => {
          const jid = job?.id;
          const href = jid ? jobDetailHref(jid) : "#";
          return (
            <JobListCard
              key={jid ?? `job-${job?.name}`}
              job={job}
              customerName={getCustomerName(job?.customerId)}
              href={href}
              onOpen={() => openJobDetail(jid)}
              dark={dark}
            />
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function JobsListView({
  jobs,
  getCustomerName,
  isPortalEmployee = false,
  dark = false,
}: JobsListViewProps) {
  const router = useRouter();

  const columns = useMemo(() => groupJobsByTagColumns(jobs), [jobs]);

  const jobDetailHref = (id: string) =>
    isPortalEmployee ? `/portal/employee/jobs/${id}` : `/portal/jobs/${id}`;

  const openJobDetail = (id: string | undefined) => {
    if (!id) return;
    router.push(jobDetailHref(id));
  };

  if (jobs.length === 0) {
    return null;
  }

  if (dark) {
    return (
      <div className="space-y-3 bg-slate-950 p-2">
        {columns.map((column, idx) => (
          <MobileTagSection
            key={column.tagKey || "__untagged__"}
            column={column}
            dark
            jobDetailHref={jobDetailHref}
            openJobDetail={openJobDetail}
            getCustomerName={getCustomerName}
            defaultOpen={idx < 2}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid w-full min-w-0 gap-3 px-3 py-4 sm:grid-cols-2 sm:gap-4 sm:px-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      )}
    >
      {columns.map((column) => (
        <section
          key={column.tagKey || "__untagged__"}
          className="flex min-h-[140px] min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60"
        >
          <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-2.5">
            <h2 className="truncate text-sm font-bold tracking-wide text-slate-900">
              {columnHeadingLabel(column.label)}
            </h2>
            <p className="text-xs text-slate-600">{zakazkyCountLabel(column.jobs.length)}</p>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 max-h-[calc(100dvh-320px)] sm:max-h-[calc(100vh-300px)]">
            {column.jobs.map((job) => {
              const jid = job?.id;
              const href = jid ? jobDetailHref(jid) : "#";
              return (
                <JobListCard
                  key={jid ?? `job-${job?.name}`}
                  job={job}
                  customerName={getCustomerName(job?.customerId)}
                  href={href}
                  onOpen={() => openJobDetail(jid)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
