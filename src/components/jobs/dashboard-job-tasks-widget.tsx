"use client";

import React, { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  collection,
  collectionGroup,
  query,
  where,
  limit,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase } from "@/firebase";
import { Loader2, ListTodo, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import {
  JOB_TASK_SCOPE,
  type JobTaskRow,
  type JobTaskPriority,
  type JobTaskStatus,
  type TaskAssignedMode,
  jobTaskPriorityLabel,
  jobTaskStatusLabel,
} from "@/lib/job-task-types";
import type { OrganizationTask } from "@/lib/organization-task";
import type { OrganizationTaskStatus } from "@/lib/organization-task";
import { isTaskOpen } from "@/lib/organization-task";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";

type JobRef = { id: string; name?: string };

type DashboardTaskItem = {
  key: string;
  source: "job" | "organization";
  taskId: string;
  jobId?: string;
  title: string;
  note: string;
  dueIso?: string;
  priority: JobTaskPriority;
  jobStatus?: JobTaskStatus;
  orgStatus?: OrganizationTaskStatus;
  jobName?: string;
  assignedTo: string | null;
  assignedMode: TaskAssignedMode;
};

const PRIORITY_RANK: Record<JobTaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function validDue(iso: string | undefined): string {
  if (!iso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return "";
  return iso.trim();
}

function formatDueShort(due: string | undefined): string {
  if (!due?.trim()) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const [y, m, d] = due.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "numeric",
    }).format(new Date(y, m - 1, d));
  } catch {
    return due;
  }
}

function parseOrgPriority(p: unknown): JobTaskPriority {
  if (p === "high" || p === "medium" || p === "low") return p;
  return "low";
}

function jobNormAssign(row: JobTaskRow): {
  mode: TaskAssignedMode;
  at: string | null;
} {
  if (row.assignedMode === "all") return { mode: "all", at: null };
  if (row.assignedMode === "single")
    return { mode: "single", at: dStr(row.assignedTo) };
  if (row.assignedTo != null && String(row.assignedTo).trim())
    return { mode: "single", at: String(row.assignedTo).trim() };
  return { mode: "all", at: null };
}

function orgNormAssign(t: OrganizationTask): {
  mode: TaskAssignedMode;
  at: string | null;
} {
  if (t.assignedMode === "all") return { mode: "all", at: null };
  if (t.assignedMode === "single")
    return { mode: "single", at: dStr(t.assignedTo) };
  if (t.assignedTo != null && String(t.assignedTo).trim())
    return { mode: "single", at: String(t.assignedTo).trim() };
  return { mode: "all", at: null };
}

function dStr(v: string | null | undefined): string | null {
  if (v == null || !String(v).trim()) return null;
  return String(v).trim();
}

function itemForAll(t: DashboardTaskItem): boolean {
  if (t.assignedMode === "all") return true;
  if (t.assignedMode === "single") return false;
  return !t.assignedTo || String(t.assignedTo).trim() === "";
}

function accentTier(
  t: DashboardTaskItem,
  todayIso: string
): "strong" | "medium" | "soft" {
  const due = validDue(t.dueIso);
  const overdue = Boolean(due && due < todayIso);
  if (overdue || t.priority === "high") return "strong";
  if (t.priority === "medium") return "medium";
  return "soft";
}

function cardAccentClass(tier: "strong" | "medium" | "soft"): string {
  switch (tier) {
    case "strong":
      return "border-rose-300/75 bg-rose-50/90 shadow-sm dark:border-rose-800/50 dark:bg-rose-950/40";
    case "medium":
      return "border-rose-200/60 bg-rose-50/60 dark:border-rose-900/38 dark:bg-rose-950/25";
    default:
      return "border-rose-100/75 bg-rose-50/40 dark:border-rose-900/28 dark:bg-rose-950/18";
  }
}

function sortDashboardTasks(
  rows: DashboardTaskItem[],
  todayIso: string
): DashboardTaskItem[] {
  return [...rows].sort((a, b) => {
    const da = validDue(a.dueIso);
    const db = validDue(b.dueIso);
    const overdueA = da && da < todayIso ? 0 : 1;
    const overdueB = db && db < todayIso ? 0 : 1;
    if (overdueA !== overdueB) return overdueA - overdueB;
    const sa = da || "9999-12-31";
    const sb = db || "9999-12-31";
    if (sa !== sb) return sa.localeCompare(sb);
    const pa = PRIORITY_RANK[a.priority];
    const pb = PRIORITY_RANK[b.priority];
    if (pa !== pb) return pa - pb;
    const aa = itemForAll(a) ? 1 : 0;
    const ab = itemForAll(b) ? 1 : 0;
    return aa - ab;
  });
}

function assignmentLine(
  t: DashboardTaskItem,
  names: Map<string, string>
): string {
  return itemForAll(t)
    ? "Všem"
    : names.get(String(t.assignedTo)) ?? t.assignedTo ?? "—";
}

/** Jeden přehled úkolů zakázek + organizace; karty, edit dialog, realtime. */
export function DashboardJobTasksWidget({
  companyId,
  todayIso,
  jobs,
}: {
  companyId: string;
  todayIso: string;
  jobs: JobRef[];
}) {
  const firestore = useFirestore();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogItem, setDialogItem] = useState<DashboardTaskItem | null>(null);
  const [dlgTitle, setDlgTitle] = useState("");
  const [dlgNote, setDlgNote] = useState("");
  const [dlgDue, setDlgDue] = useState("");
  const [dlgPriority, setDlgPriority] = useState<JobTaskPriority>("medium");
  const [dlgAssignMode, setDlgAssignMode] = useState<TaskAssignedMode>("all");
  const [dlgAssignEmp, setDlgAssignEmp] = useState("");
  const [dlgJobStatus, setDlgJobStatus] = useState<JobTaskStatus>("active");
  const [dlgOrgStatus, setDlgOrgStatus] =
    useState<OrganizationTaskStatus>("open");
  const [dlgSaving, setDlgSaving] = useState(false);

  const jobNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) {
      m.set(j.id, j.name?.trim() || j.id);
    }
    return m;
  }, [jobs]);

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw } = useCollection(employeesQuery);
  const employeeNameById = useMemo(() => {
    const m = new Map<string, string>();
    const list = Array.isArray(employeesRaw) ? employeesRaw : [];
    for (const e of list as {
      id?: string;
      firstName?: string;
      lastName?: string;
    }[]) {
      const id = String(e?.id ?? "");
      if (!id) continue;
      m.set(id, `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || id);
    }
    return m;
  }, [employeesRaw]);

  const jobTasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collectionGroup(firestore, "tasks"),
      where("companyId", "==", companyId),
      where("taskScope", "==", JOB_TASK_SCOPE),
      where("status", "==", "active"),
      limit(250)
    );
  }, [firestore, companyId]);

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, "companies", companyId, "tasks"),
      limit(300)
    );
  }, [firestore, companyId]);

  const { data: jobRaw, isLoading: jobLoading } =
    useCollection<JobTaskRow>(jobTasksQuery);
  const { data: orgRaw, isLoading: orgLoading } = useCollection(orgTasksQuery);

  const items = useMemo(() => {
    const out: DashboardTaskItem[] = [];

    const jlist = Array.isArray(jobRaw) ? jobRaw : [];
    for (const row of jlist) {
      if (row.status === "done") continue;
      const jid = row.jobId?.trim() ?? "";
      const { mode, at } = jobNormAssign(row);
      out.push({
        key: jid ? `job-${jid}-${row.id}` : `job-orphan-${row.id}`,
        source: "job",
        taskId: row.id,
        jobId: jid || undefined,
        title: row.title || "Bez názvu",
        note: row.note?.trim() || "",
        dueIso: row.dueDate?.trim() || undefined,
        priority: (row.priority as JobTaskPriority) || "low",
        jobStatus: (row.status as JobTaskStatus) || "active",
        jobName: jid ? jobNameById.get(jid) : undefined,
        assignedTo: at,
        assignedMode: mode,
      });
    }

    const olist = Array.isArray(orgRaw) ? orgRaw : [];
    for (const raw of olist) {
      const t = {
        ...raw,
        id: String((raw as { id?: string })?.id ?? ""),
      } as OrganizationTask;
      if (!t.id || !isTaskOpen(t)) continue;
      const r = raw as { dueDate?: string };
      const dueRaw =
        typeof r.dueDate === "string" && r.dueDate.trim()
          ? r.dueDate.trim()
          : undefined;
      const { mode, at } = orgNormAssign(t);

      out.push({
        key: `org-${t.id}`,
        source: "organization",
        taskId: t.id,
        title: t.title || "Bez názvu",
        note: (t.description ?? "").trim(),
        dueIso: dueRaw,
        priority: parseOrgPriority((raw as { priority?: unknown }).priority),
        orgStatus: (t.status as OrganizationTaskStatus) || "open",
        assignedTo: at,
        assignedMode: mode,
      });
    }

    return sortDashboardTasks(out, todayIso);
  }, [jobRaw, orgRaw, jobNameById, todayIso]);

  const isLoading = jobLoading || orgLoading;

  const openTaskDialog = useCallback((item: DashboardTaskItem) => {
    setDialogItem(item);
    setDlgTitle(item.title);
    setDlgNote(item.note);
    setDlgDue(validDue(item.dueIso) || "");
    setDlgPriority(item.priority);
    setDlgAssignMode(item.assignedMode);
    setDlgAssignEmp(
      item.assignedMode === "single" && item.assignedTo
        ? String(item.assignedTo)
        : ""
    );
    if (item.source === "job") {
      setDlgJobStatus(item.jobStatus ?? "active");
    } else {
      setDlgOrgStatus(item.orgStatus ?? "open");
    }
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogItem(null);
  }, []);

  const saveDialog = async () => {
    if (!firestore || !companyId || !dialogItem) return;
    const title = dlgTitle.trim();
    if (!title) {
      toast({
        variant: "destructive",
        title: "Název",
        description: "Vyplňte název úkolu.",
      });
      return;
    }
    if (dlgAssignMode === "single" && !String(dlgAssignEmp || "").trim()) {
      toast({
        variant: "destructive",
        title: "Přiřazení",
        description: "Vyberte zaměstnance nebo zvolte „Všem“.",
      });
      return;
    }
    if (dialogItem.source === "job") {
      if (!dialogItem.jobId?.trim()) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: "Chybí vazba na zakázku.",
        });
        return;
      }
      if (!dlgDue.trim()) {
        toast({
          variant: "destructive",
          title: "Termín",
          description: "U úkolu zakázky je termín povinný.",
        });
        return;
      }
    }

    setDlgSaving(true);
    try {
      const assignedTo =
        dlgAssignMode === "all"
          ? null
          : String(dlgAssignEmp || "").trim() || null;

      if (dialogItem.source === "job") {
        const jid = dialogItem.jobId!.trim();
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jid,
            "tasks",
            dialogItem.taskId
          ),
          {
            title,
            note: dlgNote.trim() || null,
            dueDate: dlgDue.trim(),
            priority: dlgPriority,
            status: dlgJobStatus,
            assignedMode: dlgAssignMode,
            assignedTo,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        const duePayload =
          dlgDue.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dlgDue.trim())
            ? dlgDue.trim()
            : null;
        await updateDoc(
          doc(firestore, "companies", companyId, "tasks", dialogItem.taskId),
          {
            title,
            description: dlgNote.trim() || null,
            dueDate: duePayload,
            priority: dlgPriority,
            status: dlgOrgStatus,
            assignedMode: dlgAssignMode,
            assignedTo,
            completedAt:
              dlgOrgStatus === "done" ? serverTimestamp() : null,
            updatedAt: serverTimestamp(),
          }
        );
      }
      toast({ title: "Uloženo" });
      closeDialog();
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Uložení se nezdařilo.",
      });
    } finally {
      setDlgSaving(false);
    }
  };

  const quickDone = async (
    e: React.MouseEvent,
    item: DashboardTaskItem
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firestore || !companyId) return;
    try {
      if (item.source === "job") {
        const jid = item.jobId?.trim();
        if (!jid) return;
        await updateDoc(
          doc(
            firestore,
            "companies",
            companyId,
            "jobs",
            jid,
            "tasks",
            item.taskId
          ),
          {
            status: "done" as JobTaskStatus,
            updatedAt: serverTimestamp(),
          }
        );
      } else {
        await updateDoc(
          doc(firestore, "companies", companyId, "tasks", item.taskId),
          {
            status: "done" as OrganizationTaskStatus,
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
        );
      }
      toast({ title: "Úkol vyřízen" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Stav se nepodařilo uložit.",
      });
    }
  };

  return (
    <>
      <section
        className="mx-auto w-full max-w-5xl rounded-lg border border-border/60 bg-muted/5 px-3 py-3 sm:px-4 sm:py-4"
        aria-label="Úkoly zakázek a organizace"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 text-muted-foreground">
          <ListTodo className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/85">
            Úkoly
          </h2>
          {!isLoading ? (
            <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
              ({items.length} aktivních)
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0 opacity-80" />
            Načítání…
          </div>
        ) : items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Žádné aktivní úkoly (zakázky ani organizace).
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((row) => {
              const tier = accentTier(row, todayIso);
              const due = validDue(row.dueIso);
              const overdue = Boolean(due && due < todayIso);

              return (
                <li key={row.key} className="min-w-0 list-none">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => openTaskDialog(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openTaskDialog(row);
                      }
                    }}
                    className={cn(
                      "flex h-full w-full cursor-pointer flex-col rounded-lg border p-3 text-left text-sm shadow-sm outline-none transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
                      cardAccentClass(tier)
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-border/80 text-[10px] font-normal"
                      >
                        {row.source === "job" ? "Zakázka" : "Organizace"}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          void quickDone(e, row);
                        }}
                      >
                        <Check className="h-3 w-3" />
                        Hotovo
                      </Button>
                    </div>
                    <p
                      className="line-clamp-2 font-semibold leading-snug text-foreground"
                      title={row.title}
                    >
                      {row.title}
                    </p>
                    {row.note ? (
                      <p
                        className="mt-1 line-clamp-2 text-xs text-muted-foreground"
                        title={row.note}
                      >
                        {row.note}
                      </p>
                    ) : null}
                    {row.source === "job" && row.jobName ? (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {row.jobName}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      <span
                        className={cn(
                          overdue &&
                            "font-medium text-rose-700 dark:text-rose-300"
                        )}
                      >
                        Termín {formatDueShort(row.dueIso)}
                        {overdue ? " · po termínu" : ""}
                      </span>
                      <span>{jobTaskPriorityLabel(row.priority)}</span>
                      <span>
                        {row.source === "job"
                          ? jobTaskStatusLabel(row.jobStatus)
                          : row.orgStatus === "done"
                            ? "Vyřízeno"
                            : "Otevřený"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Přiřazeno: {assignmentLine(row, employeeNameById)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!o) closeDialog();
          else setDialogOpen(true);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[95vw] max-w-md overflow-y-auto border-slate-200 bg-white text-slate-900">
          <DialogHeader>
            <DialogTitle>Upravit úkol</DialogTitle>
            <DialogDescription>
              Změny se ihned projeví v seznamu díky synchronizaci s Firestore.
            </DialogDescription>
          </DialogHeader>

          {dialogItem?.source === "job" && dialogItem.jobId ? (
            <p className="text-sm">
              <Link
                href={`/portal/jobs/${dialogItem.jobId}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Otevřít zakázku
              </Link>
            </p>
          ) : null}

          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="dash-task-title">Název *</Label>
              <Input
                id="dash-task-title"
                value={dlgTitle}
                onChange={(e) => setDlgTitle(e.target.value)}
                className={LIGHT_FORM_CONTROL_CLASS}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dash-task-note">Poznámka</Label>
              <Textarea
                id="dash-task-note"
                rows={3}
                value={dlgNote}
                onChange={(e) => setDlgNote(e.target.value)}
                className={LIGHT_FORM_CONTROL_CLASS}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dash-task-due">
                Termín
                {dialogItem?.source === "job" ? " *" : ""}
              </Label>
              <Input
                id="dash-task-due"
                type="date"
                value={dlgDue}
                onChange={(e) => setDlgDue(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "[color-scheme:light]"
                )}
              />
            </div>
            <div className="space-y-1">
              <Label>Priorita</Label>
              <Select
                value={dlgPriority}
                onValueChange={(v) => setDlgPriority(v as JobTaskPriority)}
              >
                <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                  <SelectItem value="low">Nízká</SelectItem>
                  <SelectItem value="medium">Střední</SelectItem>
                  <SelectItem value="high">Vysoká</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Přiřazení</Label>
              <RadioGroup
                value={dlgAssignMode}
                onValueChange={(v) =>
                  setDlgAssignMode(v as TaskAssignedMode)
                }
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="dash-am-all" />
                  <Label
                    htmlFor="dash-am-all"
                    className="cursor-pointer font-normal"
                  >
                    Všem zaměstnancům
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="single" id="dash-am-single" />
                  <Label
                    htmlFor="dash-am-single"
                    className="cursor-pointer font-normal"
                  >
                    Konkrétnímu zaměstnanci
                  </Label>
                </div>
              </RadioGroup>
              {dlgAssignMode === "single" ? (
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={dlgAssignEmp}
                  onChange={(e) => setDlgAssignEmp(e.target.value)}
                  aria-label="Zaměstnanec"
                >
                  <option value="">— vyberte —</option>
                  {(Array.isArray(employeesRaw) ? employeesRaw : [])
                    .filter((emp) =>
                      Boolean((emp as { id?: string }).id)
                    )
                    .map((emp) => {
                      const e = emp as {
                        id?: string;
                        firstName?: string;
                        lastName?: string;
                      };
                      return (
                        <option key={e.id} value={String(e.id)}>
                          {`${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() ||
                            e.id}
                        </option>
                      );
                    })}
                </select>
              ) : null}
            </div>

            {dialogItem?.source === "job" ? (
              <div className="space-y-1">
                <Label>Stav</Label>
                <Select
                  value={dlgJobStatus}
                  onValueChange={(v) =>
                    setDlgJobStatus(v as JobTaskStatus)
                  }
                >
                  <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                    <SelectItem value="active">Aktivní</SelectItem>
                    <SelectItem value="done">Vyřízeno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Stav</Label>
                <Select
                  value={dlgOrgStatus}
                  onValueChange={(v) =>
                    setDlgOrgStatus(v as OrganizationTaskStatus)
                  }
                >
                  <SelectTrigger className={LIGHT_SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={LIGHT_SELECT_CONTENT_CLASS}>
                    <SelectItem value="open">Otevřený</SelectItem>
                    <SelectItem value="done">Vyřízený</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={closeDialog}
              disabled={dlgSaving}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void saveDialog()}
              disabled={dlgSaving}
            >
              {dlgSaving ? "Ukládám…" : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
