import type { OrganizationTask } from "@/lib/organization-task";
import { isTaskOpen, organizationTaskIsForAll } from "@/lib/organization-task";
import { parseOrgTaskAssigneeRef } from "@/lib/tasks/organization-task-assignees";

export type OrganizationTaskViewerContext = {
  userId: string;
  employeeId?: string | null;
  /** Owner / admin / manager / accountant — vidí všechny úkoly v administraci. */
  canManageAllTasks?: boolean;
};

function viewerEmployeeId(ctx: OrganizationTaskViewerContext): string {
  return String(ctx.employeeId ?? "").trim();
}

function refMatchesViewer(
  ref: string | null | undefined,
  ctx: OrganizationTaskViewerContext
): boolean {
  const parsed = parseOrgTaskAssigneeRef(ref);
  const uid = String(ctx.userId ?? "").trim();
  const eid = viewerEmployeeId(ctx);
  if (parsed.userId && uid && parsed.userId === uid) return true;
  if (parsed.employeeId && eid && parsed.employeeId === eid) return true;
  if (parsed.legacyEmployeeId && eid && parsed.legacyEmployeeId === eid) return true;
  return false;
}

function taskAssignedTargets(t: OrganizationTask): string[] {
  if (t.assignedMode === "multi" && Array.isArray(t.assignedTargets)) {
    return t.assignedTargets.map((x) => String(x).trim()).filter(Boolean);
  }
  if (t.assignedTo) return [String(t.assignedTo).trim()];
  return [];
}

/** Úkol je určen konkrétně tomuto uživateli (ne režim „všem“). */
export function organizationTaskAssignedToViewer(
  t: OrganizationTask,
  ctx: OrganizationTaskViewerContext
): boolean {
  if (organizationTaskIsForAll(t)) return true;
  if (t.assignedMode === "multi") {
    const targets = taskAssignedTargets(t);
    return targets.some((ref) => refMatchesViewer(ref, ctx));
  }
  return refMatchesViewer(t.assignedTo, ctx);
}

/** Kdo smí úkol v seznamu vidět (modul / dashboard „moje“). */
export function organizationTaskVisibleToUser(
  t: OrganizationTask,
  ctx: OrganizationTaskViewerContext
): boolean {
  if (ctx.canManageAllTasks) return true;
  return organizationTaskAssignedToViewer(t, ctx);
}

function userCompletedAllMode(t: OrganizationTask, userId: string): boolean {
  const uid = String(userId ?? "").trim();
  if (!uid) return false;
  const list = Array.isArray(t.completedByUserIds) ? t.completedByUserIds : [];
  return list.map(String).includes(uid);
}

/** Otevřený úkol pro konkrétního uživatele (respektuje individuální splnění u „všem“ / multi). */
export function organizationTaskOpenForUser(
  t: OrganizationTask,
  ctx: OrganizationTaskViewerContext
): boolean {
  if (!organizationTaskVisibleToUser(t, ctx)) return false;
  if (organizationTaskIsForAll(t) || t.assignedMode === "multi") {
    if (!isTaskOpen(t)) return false;
    return !userCompletedAllMode(t, ctx.userId);
  }
  return isTaskOpen(t);
}

export function organizationTaskUserCanToggleCompletion(
  t: OrganizationTask,
  ctx: OrganizationTaskViewerContext
): boolean {
  if (ctx.canManageAllTasks) return true;
  return organizationTaskAssignedToViewer(t, ctx);
}

export function organizationTaskAssigneeSummaryLabel(
  t: OrganizationTask,
  formatOne: (ref: string) => string
): string {
  if (organizationTaskIsForAll(t)) return "Všem zaměstnancům a administrátorům";
  if (t.assignedMode === "multi") {
    const targets = taskAssignedTargets(t);
    if (targets.length === 0) return "Vybrané osoby";
    if (targets.length === 1) return formatOne(targets[0]!);
    return `${targets.length} osoby`;
  }
  if (t.assignedTo) return formatOne(String(t.assignedTo));
  return "—";
}
