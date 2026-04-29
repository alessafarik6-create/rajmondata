"use client";

import React, { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { collection, query, limit, doc, updateDoc, serverTimestamp } from "firebase/firestore";
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
  type JobTaskPriority,
  type JobTaskStatus,
  type TaskAssignedMode,
  jobTaskPriorityLabel,
  jobTaskStatusLabel,
} from "@/lib/job-task-types";
import type { OrganizationTaskStatus } from "@/lib/organization-task";
import {
  type DashboardTaskItem,
  buildMergedDashboardTaskItems,
  itemForAll,
  validDue,
} from "@/lib/dashboard-task-items-merge";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import { useActiveJobTasksFromJobList } from "@/components/jobs/use-active-job-tasks-from-jobs";

type JobRef = { id: string; name?: string };

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
  jobsLoading,
  variant = "desktop",
  maxItems,
}: {
  companyId: string;
  todayIso: string;
  jobs: JobRef[];
  /** Dokud Firebase načítá kolekci jobs — čekej, než spustíme listenery tasks pod zakázkami. */
  jobsLoading: boolean;
  /** `mobile` = tmavý RAJMONDATA styl + omezení počtu řádků. */
  variant?: "desktop" | "mobile";
  /** Pro `mobile`: max počet zobrazených položek (např. 5). */
  maxItems?: number;
}) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const cid = String(companyId ?? "").trim();
  const isMobileVariant = variant === "mobile";

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
    if (!firestore || !cid) return null;
    return collection(firestore, "companies", cid, "employees");
  }, [firestore, cid]);

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

  const jobIds = useMemo(
    () =>
      jobs
        .map((j) => String(j?.id ?? "").trim())
        .filter(Boolean),
    [jobs]
  );

  const { data: jobTasksRows, isLoading: jobTasksLoading } =
    useActiveJobTasksFromJobList(
      firestore,
      cid || undefined,
      jobIds,
      jobsLoading
    );

  const orgTasksQuery = useMemoFirebase(() => {
    if (!firestore || !cid) return null;
    return query(collection(firestore, "companies", cid, "tasks"), limit(300));
  }, [firestore, cid]);

  const { data: orgRaw, isLoading: orgLoading } = useCollection(orgTasksQuery);

  const items = useMemo(
    () =>
      buildMergedDashboardTaskItems(
        jobTasksRows,
        orgRaw,
        jobNameById,
        todayIso
      ),
    [jobTasksRows, orgRaw, jobNameById, todayIso]
  );

  const isLoading = orgLoading || jobsLoading || jobTasksLoading;

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
    if (!firestore || !cid || !dialogItem) return;
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
            cid,
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
          doc(firestore, "companies", cid, "tasks", dialogItem.taskId),
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
    if (!firestore || !cid) return;
    try {
      if (item.source === "job") {
        const jid = item.jobId?.trim();
        if (!jid) return;
        await updateDoc(
          doc(
            firestore,
            "companies",
            cid,
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
          doc(firestore, "companies", cid, "tasks", item.taskId),
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

  const visibleItems = isMobileVariant && typeof maxItems === "number" ? items.slice(0, Math.max(0, maxItems)) : items;

  function darkAccentClass(tier: "strong" | "medium" | "soft"): string {
    if (tier === "strong") return "border-l-orange-500 bg-white/[0.04]";
    if (tier === "medium") return "border-l-orange-400/80 bg-white/[0.03]";
    return "border-l-white/10 bg-white/[0.02]";
  }

  return (
    <>
      <section
        className={cn(
          "mx-auto w-full",
          isMobileVariant
            ? "rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur"
            : "max-w-5xl rounded-lg border border-border/60 bg-muted/5 px-3 py-3 sm:px-4 sm:py-4"
        )}
        aria-label="Úkoly zakázek a organizace"
      >
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center justify-between gap-2",
            isMobileVariant ? "text-slate-300" : "text-muted-foreground"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ListTodo className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <h2
              className={cn(
                "text-sm font-semibold uppercase tracking-wide",
                isMobileVariant ? "text-slate-100" : "text-foreground/85"
              )}
            >
            Úkoly
            </h2>
            {!isLoading ? (
              <span
                className={cn(
                  "text-xs font-normal normal-case tracking-normal",
                  isMobileVariant ? "text-slate-400" : "text-muted-foreground"
                )}
              >
                ({items.length} aktivních)
              </span>
            ) : null}
          </div>

          {isMobileVariant ? (
            <Button
              asChild
              type="button"
              variant="outline"
              className="min-h-11 border-white/20 bg-transparent px-4 text-slate-100 hover:bg-white/10"
            >
              <Link href="/portal/jobs">Zobrazit všechny</Link>
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <div
            className={cn(
              "flex items-center gap-2 py-6 text-sm",
              isMobileVariant ? "text-slate-300" : "text-muted-foreground"
            )}
          >
            <Loader2 className="h-4 w-4 animate-spin shrink-0 opacity-80" />
            Načítání…
          </div>
        ) : visibleItems.length === 0 ? (
          <p className={cn("py-2 text-sm", isMobileVariant ? "text-slate-300" : "text-muted-foreground")}>
            Žádné aktivní úkoly (zakázky ani organizace).
          </p>
        ) : (
          <ul
            className={cn(
              "gap-3",
              isMobileVariant ? "flex flex-col" : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {visibleItems.map((row) => {
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
                      "flex h-full w-full cursor-pointer flex-col border p-3 text-left text-sm shadow-sm outline-none transition focus-visible:ring-2",
                      isMobileVariant
                        ? cn(
                            "rounded-2xl border-white/10 text-slate-100 hover:bg-white/[0.06] focus-visible:ring-orange-500/40 border-l-[6px]",
                            darkAccentClass(tier)
                          )
                        : cn(
                            "rounded-lg hover:shadow-md focus-visible:ring-ring",
                            cardAccentClass(tier)
                          )
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px] font-normal",
                          isMobileVariant
                            ? "border-white/15 bg-white/5 text-slate-200"
                            : "border-border/80"
                        )}
                      >
                        {row.source === "job" ? "Zakázka" : "Organizace"}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className={cn(
                          "h-7 shrink-0 gap-1 px-2 text-[11px]",
                          isMobileVariant && "border border-white/15 bg-white/10 text-white hover:bg-white/15"
                        )}
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
                      className={cn(
                        "line-clamp-2 font-semibold leading-snug",
                        isMobileVariant ? "text-white" : "text-foreground"
                      )}
                      title={row.title}
                    >
                      {row.title}
                    </p>
                    {row.note ? (
                      <p
                        className={cn(
                          "mt-1 line-clamp-2 text-xs",
                          isMobileVariant ? "text-slate-300" : "text-muted-foreground"
                        )}
                        title={row.note}
                      >
                        {row.note}
                      </p>
                    ) : null}
                    {row.source === "job" && row.jobName ? (
                      <p className={cn("mt-1 truncate text-[11px]", isMobileVariant ? "text-slate-400" : "text-muted-foreground")}>
                        {row.jobName}
                      </p>
                    ) : null}
                    <div className={cn("mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px]", isMobileVariant ? "text-slate-400" : "text-muted-foreground")}>
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
                    <p className={cn("mt-1 text-[11px]", isMobileVariant ? "text-slate-300" : "text-muted-foreground")}>
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
