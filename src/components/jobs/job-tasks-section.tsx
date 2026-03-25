"use client";

import React, { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useFirestore, useCollection, useMemoFirebase, useDoc } from "@/firebase";
import { logActivitySafe } from "@/lib/activity-log";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  LIGHT_FORM_CONTROL_CLASS,
  LIGHT_SELECT_CONTENT_CLASS,
  LIGHT_SELECT_TRIGGER_CLASS,
} from "@/lib/light-form-control-classes";
import {
  JOB_TASK_SCOPE,
  type JobTaskPriority,
  type JobTaskRow,
  type JobTaskStatus,
  jobTaskPriorityLabel,
  jobTaskStatusLabel,
  sortJobTasksForJobDetail,
} from "@/lib/job-task-types";
import {
  Check,
  ListTodo,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

function todayIso(): string {
  const t = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function taskRowAccentClasses(
  row: JobTaskRow,
  today: string,
  isDone: boolean
): string {
  if (isDone) {
    return "border-l-4 border-muted-foreground/40 bg-muted/20 opacity-80";
  }
  const due = String(row.dueDate ?? "");
  const overdue = due && due < today;
  const pr = row.priority ?? "low";
  if (overdue) {
    return "border-l-4 border-destructive bg-destructive/10 ring-1 ring-destructive/30";
  }
  if (pr === "high") return "border-l-4 border-red-600 bg-red-50/60 dark:bg-red-950/25";
  if (pr === "medium") return "border-l-4 border-amber-500 bg-amber-50/50 dark:bg-amber-950/20";
  return "border-l-4 border-blue-400 bg-blue-50/40 dark:bg-blue-950/20";
}

type Props = {
  companyId: string;
  jobId: string;
  user: User;
  canEdit: boolean;
};

export function JobTasksSection({ companyId, jobId, user, canEdit }: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const today = todayIso();
  const actorRef = useMemoFirebase(
    () => (firestore && user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: actorProfile } = useDoc(actorRef);

  const tasksCol = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "tasks"
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: tasksRaw } = useCollection<JobTaskRow>(tasksCol);
  const tasks = tasksRaw ?? [];

  const { active, done } = useMemo(
    () => sortJobTasksForJobDetail(tasks, today),
    [tasks, today]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [dueInput, setDueInput] = useState(todayIso());
  const [priorityInput, setPriorityInput] = useState<JobTaskPriority>("medium");
  const [statusInput, setStatusInput] = useState<JobTaskStatus>("active");
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setTitleInput("");
    setNoteInput("");
    setDueInput(todayIso());
    setPriorityInput("medium");
    setStatusInput("active");
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (row: JobTaskRow) => {
    setEditingId(row.id);
    setTitleInput(row.title ?? "");
    setNoteInput(row.note ?? "");
    setDueInput(
      row.dueDate && row.dueDate.length >= 8 ? row.dueDate : todayIso()
    );
    setPriorityInput((row.priority as JobTaskPriority) || "medium");
    setStatusInput((row.status as JobTaskStatus) || "active");
    setDialogOpen(true);
  };

  const persist = async () => {
    const title = titleInput.trim();
    if (!title) {
      toast({
        title: "Název úkolu",
        description: "Vyplňte název úkolu.",
        variant: "destructive",
      });
      return;
    }
    if (!firestore || !companyId || !jobId?.trim()) return;
    if (!dueInput.trim()) {
      toast({
        title: "Termín",
        description: "Vyberte termín.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const col = collection(
        firestore,
        "companies",
        companyId,
        "jobs",
        jobId,
        "tasks"
      );
      const noteTrim = noteInput.trim();

      if (editingId) {
        await updateDoc(doc(col, editingId), {
          title,
          note: noteTrim || null,
          dueDate: dueInput.trim(),
          priority: priorityInput,
          status: statusInput,
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Úkol uložen" });
      } else {
        await addDoc(col, {
          companyId,
          jobId,
          taskScope: JOB_TASK_SCOPE,
          title,
          note: noteTrim || null,
          dueDate: dueInput.trim(),
          priority: priorityInput,
          status: "active" as JobTaskStatus,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Úkol přidán" });
      }
      setDialogOpen(false);
      resetForm();
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const markDone = async (row: JobTaskRow) => {
    if (!firestore || !companyId || !jobId) return;
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "tasks",
          row.id
        ),
        { status: "done" as JobTaskStatus, updatedAt: serverTimestamp() }
      );
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "task.status_change",
        actionLabel: "Úkol označen jako hotový",
        entityType: "job_task",
        entityId: row.id,
        entityName: row.title ?? row.id,
        details: "Stav: active → done",
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: { jobId, taskId: row.id, previousStatus: "active", newStatus: "done" },
      });
      toast({ title: "Úkol hotový" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Stav se nepodařilo uložit.",
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleteId || !firestore || !companyId || !jobId) return;
    setDeleting(true);
    try {
      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "tasks",
          deleteId
        )
      );
      logActivitySafe(firestore, companyId, user, actorProfile, {
        actionType: "task.delete",
        actionLabel: "Smazání úkolu zakázky",
        entityType: "job_task",
        entityId: deleteId,
        sourceModule: "jobs",
        route: `/portal/jobs/${jobId}`,
        metadata: { jobId, taskId: deleteId },
      });
      toast({ title: "Úkol smazán" });
      setDeleteId(null);
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
      });
    } finally {
      setDeleting(false);
    }
  };

  const renderTaskRow = (row: JobTaskRow, isDone: boolean) => (
    <li
      key={row.id}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:py-2 min-h-0",
        taskRowAccentClasses(row, today, isDone)
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold text-sm leading-tight truncate" title={row.title}>
          {row.title}
        </p>
        {row.note ? (
          <p className="text-xs text-muted-foreground line-clamp-2" title={row.note}>
            {row.note}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Badge variant="outline" className="text-[10px] font-normal h-5 px-1.5">
            Termín {row.dueDate ?? "—"}
            {row.dueDate && row.dueDate < today && !isDone ? (
              <span className="text-destructive font-semibold ml-1">(po termínu)</span>
            ) : null}
          </Badge>
          <Badge
            variant="secondary"
            className="text-[10px] font-normal h-5 px-1.5"
          >
            {jobTaskPriorityLabel(row.priority)}
          </Badge>
          <Badge
            className={cn(
              "text-[10px] font-normal h-5 px-1.5",
              isDone ? "bg-muted" : "bg-primary/15 text-primary"
            )}
          >
            {jobTaskStatusLabel(row.status)}
          </Badge>
        </div>
      </div>
      {canEdit ? (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => openEdit(row)}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Upravit
          </Button>
          {!isDone ? (
            <Button
              type="button"
              size="sm"
              className="h-8 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => void markDone(row)}
            >
              <Check className="h-3.5 w-3.5" />
              Hotovo
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs text-destructive"
            onClick={() => setDeleteId(row.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}
    </li>
  );

  const hasAny = active.length > 0 || done.length > 0;

  return (
    <>
      <section
        className={cn(
          "rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-background to-background p-4 shadow-sm",
          active.some(
            (r) =>
              r.dueDate && r.dueDate < today && r.status !== "done"
          ) && "border-destructive/50 from-destructive/5"
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ListTodo className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">Úkoly k zakázce</h2>
              <p className="text-xs text-muted-foreground">
                Aktivní úkoly řazené podle termínu a priority; po splatnosti zvýrazněny.
              </p>
            </div>
          </div>
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto shrink-0 gap-1 min-h-[40px]"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4" />
              Přidat úkol
            </Button>
          ) : null}
        </div>

        {!hasAny ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Zatím žádné úkoly.{" "}
            {canEdit ? "Přidejte první úkol výše." : ""}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {active.length > 0 ? (
              <ul className="space-y-2">{active.map((r) => renderTaskRow(r, false))}</ul>
            ) : (
              <p className="text-sm text-muted-foreground">Žádné aktivní úkoly.</p>
            )}
            {done.length > 0 ? (
              <div className="space-y-2 pt-2 border-t border-border/50">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Hotové ({done.length})
                </p>
                <ul className="space-y-2">{done.map((r) => renderTaskRow(r, true))}</ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="bg-white border-slate-200 text-slate-900 w-[95vw] max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Upravit úkol" : "Nový úkol"}</DialogTitle>
            <DialogDescription>
              Vyplňte údaje úkolu vázané na tuto zakázku.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="jt-title">Název *</Label>
              <Input
                id="jt-title"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[44px]")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jt-note">Popis / poznámka</Label>
              <Textarea
                id="jt-note"
                rows={3}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className={cn(LIGHT_FORM_CONTROL_CLASS, "min-h-[88px]")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jt-due">Termín *</Label>
              <Input
                id="jt-due"
                type="date"
                value={dueInput}
                onChange={(e) => setDueInput(e.target.value)}
                className={cn(
                  LIGHT_FORM_CONTROL_CLASS,
                  "[color-scheme:light] min-h-[44px]"
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>Priorita</Label>
              <Select
                value={priorityInput}
                onValueChange={(v) => setPriorityInput(v as JobTaskPriority)}
              >
                <SelectTrigger
                  className={cn(LIGHT_SELECT_TRIGGER_CLASS, "min-h-[44px]")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                  <SelectItem value="low">Nízká</SelectItem>
                  <SelectItem value="medium">Střední</SelectItem>
                  <SelectItem value="high">Vysoká</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editingId ? (
              <div className="space-y-2">
                <Label>Stav</Label>
                <Select
                  value={statusInput}
                  onValueChange={(v) => setStatusInput(v as JobTaskStatus)}
                >
                  <SelectTrigger
                    className={cn(LIGHT_SELECT_TRIGGER_CLASS, "min-h-[44px]")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={cn(LIGHT_SELECT_CONTENT_CLASS)}>
                    <SelectItem value="active">Aktivní</SelectItem>
                    <SelectItem value="done">Hotovo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              className="min-h-[44px]"
              disabled={submitting}
              onClick={() => void persist()}
            >
              {submitting ? "Ukládám…" : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-white border-slate-200 w-[95vw] max-w-sm">
          <DialogHeader>
            <DialogTitle>Smazat úkol?</DialogTitle>
            <DialogDescription>Tato akce je nevratná.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>
              Zrušit
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              {deleting ? "Mažu…" : "Smazat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
