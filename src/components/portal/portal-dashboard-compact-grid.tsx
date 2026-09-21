"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { collection, doc, limit, query } from "firebase/firestore";
import { useCollection, useMemoFirebase, useUser, useDoc } from "@/firebase";
import { DashboardCompactCalendar } from "@/components/portal/dashboard-compact-calendar";
import {
  Briefcase,
  Inbox,
  ListTodo,
  MessageSquare,
  Activity,
} from "lucide-react";
import { DashboardEmailAttentionWidget } from "@/components/portal/dashboard-email-attention-widget";
import { DashboardDocumentsToPayWidget } from "@/components/portal/dashboard-documents-to-pay-widget";
import { DashboardTerminalActiveWidget } from "@/components/portal/dashboard-terminal-active-widget";
import { DashboardCompactCard } from "@/components/portal/dashboard-compact-card";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { useActiveJobTasksFromJobList } from "@/components/jobs/use-active-job-tasks-from-jobs";
import { useFirestore } from "@/firebase";
import { buildMergedDashboardTaskItems } from "@/lib/dashboard-task-items-merge";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { stableImportLeadDocumentId } from "@/lib/import-lead-keys";
import { InquiryTypeBadge } from "@/components/inquiry-type-badge";
import {
  resolveInquiryTypeRaw,
  type InquiryTypeOverlayFields,
} from "@/lib/inquiry-type-badge";
import type { AttendanceRow } from "@/lib/employee-attendance";
import type { DashboardActivityRow } from "@/components/portal/dashboard-activity-section";
import { formatDashboardActivityTime } from "@/components/portal/dashboard-activity-section";
import { safeTime } from "@/lib/date-safe";
import { useUserDashboardLayout } from "@/hooks/use-user-dashboard-layout";
import {
  PortalDashboardDraggableGrid,
  type DashboardWidgetSlot,
} from "@/components/portal/portal-dashboard-draggable-grid";
import type { DashboardWidgetId } from "@/lib/dashboard-widget-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DashboardCamerasCompact,
  DashboardFleetCompact,
  DashboardOffersCompact,
  DashboardPendingDocumentsCompact,
  DashboardProductionCompact,
  DashboardWarehouseCompact,
  filterImportantDashboardActivities,
  type PendingDocPreview,
} from "@/components/portal/dashboard-compact-data-widgets";
type JobData = {
  id: string;
  name?: string;
  status?: string;
  endDate?: string;
};

export type PortalDashboardCompactGridProps = {
  companyId: string;
  todayIso: string;
  jobs: JobData[];
  allJobs: JobData[];
  jobsLoading: boolean;
  importLeadsRows: LeadImportRow[];
  importLeadsLoading: boolean;
  latestLeads: LeadImportRow[];
  importLeadOverlayByKey: Map<string, InquiryTypeOverlayFields & { receivedAt?: unknown }>;
  employees: Record<string, unknown>[] | undefined;
  attendanceTodayRows: AttendanceRow[];
  openWorkSegmentRows: Array<Record<string, unknown> & { id: string }>;
  attendanceLoading: boolean;
  customerActivities: DashboardActivityRow[];
  employeeActivities: DashboardActivityRow[];
  unreadChatCount: number;
  chatLoading: boolean;
  pendingDocuments: PendingDocPreview[];
  fleetConnected: boolean;
  scheduleTodayCount?: number;
  restrictScheduleForEmployee?: boolean;
};

export function PortalDashboardCompactGrid(props: PortalDashboardCompactGridProps) {
  const firestore = useFirestore();
  const { user } = useUser();
  const isMobile = useIsMobile();
  const { order, saveOrder, resetLayout } = useUserDashboardLayout(props.companyId);

  const userRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: userProfile } = useDoc(userRef);
  const viewerEmployeeId = String(
    (userProfile as { employeeId?: string } | null)?.employeeId ?? ""
  ).trim();
  const emailAccess = usePortalModuleAccess("emails");
  const jobsAccess = usePortalModuleAccess("jobs");
  const leadsAccess = usePortalModuleAccess("leads");
  const documentsAccess = usePortalModuleAccess("documents");
  const laborAccess = usePortalModuleAccess("labor");
  const fleetAccess = usePortalModuleAccess("fleet");
  const camerasAccess = usePortalModuleAccess("cameras");
  const skladAccess = usePortalModuleAccess("sklad");
  const vyrobaAccess = usePortalModuleAccess("vyroba");
  const offersAccess = usePortalModuleAccess("offers");
  const meetingsAccess = usePortalModuleAccess("meetingRecords");

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of props.allJobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [props.allJobs]);

  const jobIds = useMemo(
    () => props.allJobs.map((j) => j.id).filter(Boolean),
    [props.allJobs]
  );
  const { data: taskRows, isLoading: jobTasksLoading } = useActiveJobTasksFromJobList(
    firestore,
    props.companyId,
    jobIds,
    props.jobsLoading
  );

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !props.companyId) return null;
    return query(
      collection(firestore, "companies", props.companyId, "tasks"),
      limit(300)
    );
  }, [firestore, props.companyId]);

  const { data: orgRaw, isLoading: orgTasksLoading } = useCollection(orgTasksQuery);

  const mergedTasks = useMemo(
    () =>
      buildMergedDashboardTaskItems(
        taskRows ?? [],
        orgRaw,
        jobNameById,
        props.todayIso
      ),
    [taskRows, orgRaw, jobNameById, props.todayIso]
  );
  const openTasks = useMemo(() => mergedTasks.slice(0, 3), [mergedTasks]);
  const overdueTasks = useMemo(
    () =>
      mergedTasks.filter((t) => t.dueIso && t.dueIso < props.todayIso).length,
    [mergedTasks, props.todayIso]
  );
  const tasksLoading = props.jobsLoading || jobTasksLoading || orgTasksLoading;

  const jobStats = useMemo(() => {
    const active = props.jobs.filter((j) => j.status !== "dokončená");
    const overdue = active.filter((j) => j.endDate && j.endDate < props.todayIso);
    const sorted = [...active].sort((a, b) => {
      const da = a.endDate || "9999";
      const db = b.endDate || "9999";
      return da.localeCompare(db);
    });
    return {
      active: active.length,
      overdue: overdue.length,
      top: sorted.slice(0, 3),
    };
  }, [props.jobs, props.todayIso]);

  const leadStats = useMemo(() => {
    const rows = props.importLeadsRows;
    const open = rows.filter((r) => !String(r.stav ?? "").toLowerCase().includes("uzav"));
    return { total: rows.length, open: open.length, latest: props.latestLeads.slice(0, 3) };
  }, [props.importLeadsRows, props.latestLeads]);

  const activityItems = useMemo(() => {
    const filteredCustomer = filterImportantDashboardActivities(props.customerActivities);
    const merged = [...filteredCustomer, ...props.employeeActivities];
    merged.sort((a, b) => {
      const ta = safeTime(a.createdAt ?? a.timestamp ?? a.sentAt);
      const tb = safeTime(b.createdAt ?? b.timestamp ?? b.sentAt);
      return tb - ta;
    });
    return merged.slice(0, 4);
  }, [props.customerActivities, props.employeeActivities]);

  const slots = useMemo(() => {
    const list: DashboardWidgetSlot[] = [];

    if (emailAccess.canRead) {
      list.push({
        id: "emails",
        node: <DashboardEmailAttentionWidget companyId={props.companyId} />,
      });
    }
    if (jobsAccess.canRead) {
      list.push({
        id: "jobs",
        node: (
          <DashboardCompactCard
            title="Zakázky"
            icon={<Briefcase className="h-4 w-4 text-orange-600" />}
            accentClass="border-l-orange-500"
            href="/portal/jobs"
            footerLabel="Otevřít zakázky"
          >
            {props.jobsLoading ? (
              <p className="text-xs text-muted-foreground">Načítání…</p>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-3 text-muted-foreground">
                  <span>
                    Aktivní: <strong className="text-foreground">{jobStats.active}</strong>
                  </span>
                  <span>
                    Po termínu: <strong className="text-foreground">{jobStats.overdue}</strong>
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {jobStats.top.map((j) => (
                    <li key={j.id}>
                      <Link
                        href={`/portal/jobs/${encodeURIComponent(j.id)}`}
                        className="block rounded-md border border-border/60 px-2 py-1.5 hover:bg-muted/40"
                      >
                        <p className="truncate font-medium">{j.name || "Zakázka"}</p>
                        <p className="text-[11px] text-muted-foreground flex justify-between gap-2">
                          <span>{j.status || "—"}</span>
                          {j.endDate ? (
                            <span>
                              Termín{" "}
                              {j.endDate === props.todayIso
                                ? "dnes"
                                : new Date(j.endDate + "T12:00:00").toLocaleDateString("cs-CZ")}
                            </span>
                          ) : null}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </DashboardCompactCard>
        ),
      });
    }
    if (leadsAccess.canRead) {
      list.push({
        id: "leads",
        node: (
          <DashboardCompactCard
            title="Poptávky"
            icon={<Inbox className="h-4 w-4 text-violet-600" />}
            accentClass="border-l-violet-500"
            href="/portal/leads"
            footerLabel="Všechny poptávky"
          >
            {props.importLeadsLoading ? (
              <p className="text-xs text-muted-foreground">Načítání…</p>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Celkem <strong className="text-foreground">{leadStats.total}</strong> · otevřené{" "}
                  <strong className="text-foreground">{leadStats.open}</strong>
                </p>
                <ul className="space-y-1">
                  {leadStats.latest.map((r) => {
                    const key = stableImportLeadDocumentId(r);
                    const overlay = props.importLeadOverlayByKey.get(key);
                    return (
                      <li key={key}>
                        <Link
                          href={`/portal/leads?openLead=${encodeURIComponent(key)}`}
                          className="block truncate rounded border border-border/50 px-2 py-1 hover:bg-muted/30"
                        >
                          {r.jmeno?.trim() || "Poptávka"}{" "}
                          <InquiryTypeBadge
                            type={resolveInquiryTypeRaw(r, overlay)}
                            variant="preview"
                            className="ml-1 inline text-[9px]"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </DashboardCompactCard>
        ),
      });
    }
    if (documentsAccess.canRead) {
      list.push({
        id: "documentsToPay",
        node: (
          <DashboardDocumentsToPayWidget
            companyId={props.companyId}
            todayIso={props.todayIso}
            layout="compact"
          />
        ),
      });
    }
    if (meetingsAccess.canRead || jobsAccess.canRead) {
      list.push({
        id: "calendar",
        colSpanClass: "md:col-span-2 xl:col-span-2",
        node: (
          <DashboardCompactCalendar
            companyId={props.companyId}
            todayIso={props.todayIso}
            jobs={props.jobs}
            tasks={mergedTasks}
            canMeetings={meetingsAccess.canRead || leadsAccess.canRead}
            canJobs={jobsAccess.canRead}
            canTasks={jobsAccess.canRead}
            restrictEmployeeEvents={Boolean(props.restrictScheduleForEmployee)}
            viewerUid={user?.uid ?? ""}
            viewerEmployeeId={viewerEmployeeId}
            canPlanEvents={
              leadsAccess.canWrite && !props.restrictScheduleForEmployee
            }
          />
        ),
      });
    }
    if (jobsAccess.canRead) {
      list.push({
        id: "tasks",
        node: (
          <DashboardCompactCard
            title="Úkoly"
            icon={<ListTodo className="h-4 w-4 text-amber-600" />}
            accentClass="border-l-amber-500"
            href="/portal/jobs"
            footerLabel="Zobrazit úkoly"
          >
            {tasksLoading ? (
              <p className="text-xs text-muted-foreground">Načítání…</p>
            ) : (
              <div className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  Aktivní: <strong className="text-foreground">{mergedTasks.length}</strong>
                  {" · "}
                  Po termínu: <strong className="text-foreground">{overdueTasks}</strong>
                </p>
                <ul className="space-y-1">
                  {openTasks.map((t) => (
                    <li key={t.key} className="truncate rounded border border-border/50 px-2 py-1">
                      {t.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </DashboardCompactCard>
        ),
      });
    }
    if (laborAccess.canRead) {
      list.push({
        id: "labor",
        node: (
          <div className="[&_article]:min-h-[240px]">
            <DashboardTerminalActiveWidget
              employees={props.employees}
              attendanceTodayRows={props.attendanceTodayRows}
              openWorkSegmentRows={props.openWorkSegmentRows}
              loading={props.attendanceLoading}
              layout="compact"
            />
          </div>
        ),
      });
    }
    if (offersAccess.canRead) {
      list.push({
        id: "offers",
        node: <DashboardOffersCompact companyId={props.companyId} />,
      });
    }
    if (!props.chatLoading && props.unreadChatCount > 0) {
      list.push({
        id: "messages",
        node: (
          <DashboardCompactCard
            title="Zprávy"
            icon={<MessageSquare className="h-4 w-4 text-red-600" />}
            accentClass="border-l-red-500"
            href="/portal/chat"
            footerLabel="Otevřít chat"
          >
            <p className="text-lg font-semibold text-red-700">
              {props.unreadChatCount} nepřečtených
            </p>
          </DashboardCompactCard>
        ),
      });
    }
    if (skladAccess.canRead) {
      list.push({
        id: "warehouse",
        node: <DashboardWarehouseCompact companyId={props.companyId} />,
      });
    }
    if (vyrobaAccess.canRead) {
      list.push({
        id: "production",
        node: <DashboardProductionCompact companyId={props.companyId} />,
      });
    }
    if (fleetAccess.canRead) {
      list.push({
        id: "fleet",
        node: (
          <DashboardFleetCompact
            companyId={props.companyId}
            fleetConnected={props.fleetConnected}
          />
        ),
      });
    }
    if (camerasAccess.canRead) {
      list.push({
        id: "cameras",
        node: <DashboardCamerasCompact companyId={props.companyId} />,
      });
    }
    if (documentsAccess.canRead && props.pendingDocuments.length > 0) {
      list.push({
        id: "pendingDocuments",
        node: <DashboardPendingDocumentsCompact pendingDocuments={props.pendingDocuments} />,
      });
    }
    if (activityItems.length > 0) {
      list.push({
        id: "activity",
        node: (
          <DashboardCompactCard
            title="Aktivita"
            icon={<Activity className="h-4 w-4 text-primary" />}
            accentClass="border-l-primary"
            href="/portal/report"
            footerLabel="Zobrazit vše"
          >
            <ul className="space-y-1.5 text-xs">
              {activityItems.map((row) => (
                <li key={row.id} className="truncate border-b border-border/40 pb-1 last:border-0">
                  <span className="font-medium">{row.title || row.message || "Aktivita"}</span>
                  <span className="text-muted-foreground ml-1">
                    · {formatDashboardActivityTime(row)}
                  </span>
                </li>
              ))}
            </ul>
          </DashboardCompactCard>
        ),
      });
    }

    return list;
  }, [
    emailAccess.canRead,
    jobsAccess.canRead,
    leadsAccess.canRead,
    documentsAccess.canRead,
    meetingsAccess.canRead,
    laborAccess.canRead,
    offersAccess.canRead,
    skladAccess.canRead,
    vyrobaAccess.canRead,
    fleetAccess.canRead,
    camerasAccess.canRead,
    props,
    jobStats,
    leadStats,
    mergedTasks,
    openTasks,
    overdueTasks,
    tasksLoading,
    activityItems,
    user?.uid,
    viewerEmployeeId,
    leadsAccess.canWrite,
  ]);

  return (
    <PortalDashboardDraggableGrid
      slots={slots}
      order={order}
      onOrderChange={(next) => void saveOrder(next as DashboardWidgetId[])}
      onResetLayout={() => void resetLayout()}
      dragEnabled={!isMobile}
    />
  );
}
