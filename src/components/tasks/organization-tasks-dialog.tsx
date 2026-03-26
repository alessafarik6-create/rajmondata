"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  limit,
} from "firebase/firestore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import type { OrganizationTask } from "@/lib/organization-task";
import {
  isTaskOpen,
  organizationTaskIsForAll,
} from "@/lib/organization-task";
import type { JobTaskPriority, TaskAssignedMode } from "@/lib/job-task-types";
import { jobTaskPriorityLabel } from "@/lib/job-task-types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Vlastník, admin, manažer, účetní — plná správa */
  canManage: boolean;
  /** Firestore zaměstnanec id přihlášeného */
  employeeId: string | null | undefined;
};

function formatTaskDate(v: unknown): string {
  if (!v) return "—";
  if (typeof v === "object" && v !== null && "toDate" in v) {
    const d = (v as { toDate: () => Date }).toDate();
    return d.toLocaleString("cs-CZ", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return "—";
}

function formatDueCs(iso: string | undefined): string {
  if (!iso?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).format(new Date(y, m - 1, d));
  } catch {
    return iso;
  }
}

export function OrganizationTasksDialog({
  open,
  onOpenChange,
  companyId,
  canManage,
  employeeId,
}: Props) {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, "companies", companyId, "employees");
  }, [firestore, companyId]);

  const { data: employeesRaw } = useCollection(employeesQuery);
  const employeesList = Array.isArray(employeesRaw) ? employeesRaw : [];

  const employeeNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employeesList as {
      id?: string;
      firstName?: string;
      lastName?: string;
    }[]) {
      const id = String(e?.id ?? "");
      if (!id) continue;
      const nm = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || id;
      m.set(id, nm);
    }
    return m;
  }, [employeesList]);

  const tasksQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, "companies", companyId, "tasks"), limit(300));
  }, [firestore, companyId]);

  const { data: tasksRaw, isLoading: tasksLoading } =
    useCollection<any>(tasksQuery);
  const tasksList = Array.isArray(tasksRaw) ? tasksRaw : [];

  const tasks = useMemo(() => {
    const list = tasksList.map(
      (t) =>
        ({
          ...t,
          id: String(t?.id ?? ""),
        }) as OrganizationTask
    );
    list.sort((a, b) => {
      const ta = a.createdAt as { toDate?: () => Date } | undefined;
      const tb = b.createdAt as { toDate?: () => Date } | undefined;
      const da = ta?.toDate?.()?.getTime() ?? 0;
      const db = tb?.toDate?.()?.getTime() ?? 0;
      return db - da;
    });
    return list;
  }, [tasksRaw]);

  const visibleTasks = useMemo(() => {
    if (canManage) return tasks;
    const eid = String(employeeId || "").trim();
    if (!eid) return [];
    return tasks.filter(
      (t) =>
        organizationTaskIsForAll(t) || String(t.assignedTo) === eid
    );
  }, [tasks, canManage, employeeId]);

  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<JobTaskPriority>("medium");
  const [assignMode, setAssignMode] = useState<TaskAssignedMode>("all");
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setIsEditing(false);
      setEditingId(null);
    }
  }, [open]);

  const openCreate = () => {
    setEditingId(null);
    setTitle("");
    setDescription("");
    setDueDate("");
    setPriority("medium");
    setAssignMode("all");
    setAssignEmployeeId("");
    setIsEditing(true);
  };

  const openEdit = (t: OrganizationTask) => {
    setEditingId(t.id);
    setTitle(t.title ?? "");
    setDescription(t.description ?? "");
    setDueDate(
      typeof t.dueDate === "string" && t.dueDate.length >= 8 ? t.dueDate : ""
    );
    const pr = t.priority;
    setPriority(
      pr === "high" || pr === "medium" || pr === "low" ? pr : "medium"
    );
    if (organizationTaskIsForAll(t)) {
      setAssignMode("all");
      setAssignEmployeeId("");
    } else {
      setAssignMode("single");
      setAssignEmployeeId(t.assignedTo ? String(t.assignedTo) : "");
    }
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setDueDate("");
    setPriority("medium");
    setAssignMode("all");
    setAssignEmployeeId("");
  };

  const saveTask = async () => {
    if (!user || !companyId || !title.trim()) {
      toast({
        variant: "destructive",
        title: "Chybí název",
        description: "Vyplňte název úkolu.",
      });
      return;
    }
    if (!canManage) return;
    if (
      assignMode === "single" &&
      !String(assignEmployeeId || "").trim()
    ) {
      toast({
        variant: "destructive",
        title: "Přiřazení",
        description: "U režimu „konkrétní zaměstnanec“ vyberte osobu.",
      });
      return;
    }
    setSaving(true);
    try {
      const assignedTo =
        assignMode === "all" ? null : String(assignEmployeeId).trim();
      const duePayload =
        dueDate.trim() && /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())
          ? dueDate.trim()
          : null;

      if (editingId) {
        await updateDoc(
          doc(firestore, "companies", companyId, "tasks", editingId),
          {
            title: title.trim(),
            description: description.trim() || null,
            dueDate: duePayload,
            priority,
            assignedMode: assignMode,
            assignedTo,
            updatedAt: serverTimestamp(),
          }
        );
        toast({ title: "Uloženo", description: "Úkol byl aktualizován." });
      } else {
        await addDoc(collection(firestore, "companies", companyId, "tasks"), {
          title: title.trim(),
          description: description.trim() || null,
          dueDate: duePayload,
          priority,
          organizationId: companyId,
          status: "open" as const,
          assignedMode: assignMode,
          assignedTo,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          completedAt: null,
        });
        toast({ title: "Vytvořeno", description: "Úkol byl přidán." });
      }
      cancelEdit();
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (t: OrganizationTask) => {
    if (!companyId) return;
    const next = isTaskOpen(t) ? "done" : "open";
    if (!canManage) {
      const mine =
        organizationTaskIsForAll(t) ||
        String(t.assignedTo) === String(employeeId || "");
      if (!mine) return;
    }
    try {
      await updateDoc(doc(firestore, "companies", companyId, "tasks", t.id), {
        status: next,
        completedAt: next === "done" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Nepodařilo se změnit stav.",
      });
    }
  };

  const removeTask = async (id: string) => {
    if (!canManage || !companyId) return;
    if (!confirm("Smazat tento úkol?")) return;
    try {
      await deleteDoc(doc(firestore, "companies", companyId, "tasks", id));
      toast({ title: "Smazáno" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Chyba",
        description: "Smazání se nezdařilo.",
      });
    }
  };

  const openList = tasks.filter((t) => isTaskOpen(t));
  const doneList = tasks.filter((t) => !isTaskOpen(t));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col border-slate-200 bg-white text-slate-900">
        <DialogHeader>
          <DialogTitle>Úkoly organizace</DialogTitle>
          <DialogDescription>
            {canManage
              ? "Vytvářejte úkoly a přiřazujte je všem nebo konkrétnímu zaměstnanci. Nevyřízené úkoly se zobrazují na přehledu portálu."
              : "Úkoly pro všechny nebo přiřazené vám. Stav můžete měnit u příslušných úkolů."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Button
              type="button"
              size="sm"
              onClick={() => (isEditing ? cancelEdit() : openCreate())}
            >
              {isEditing ? "Zrušit úpravy" : "Nový úkol"}
            </Button>
          ) : null}
        </div>

        {canManage && isEditing ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">
              {editingId ? "Upravit úkol" : "Nový úkol"}
            </p>
            <div className="space-y-1">
              <Label htmlFor="task-title">Název *</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Krátký popis úkolu"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-desc">Poznámka / popis</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Volitelné podrobnosti"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-due">Termín</Label>
              <Input
                id="task-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="[color-scheme:light]"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-priority">Priorita</Label>
              <select
                id="task-priority"
                className={NATIVE_SELECT_CLASS}
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as JobTaskPriority)
                }
              >
                <option value="low">Nízká</option>
                <option value="medium">Střední</option>
                <option value="high">Vysoká</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Přiřazení</Label>
              <RadioGroup
                value={assignMode}
                onValueChange={(v) =>
                  setAssignMode(v as TaskAssignedMode)
                }
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="ot-am-all" />
                  <Label htmlFor="ot-am-all" className="font-normal cursor-pointer">
                    Všem zaměstnancům
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="single" id="ot-am-single" />
                  <Label
                    htmlFor="ot-am-single"
                    className="font-normal cursor-pointer"
                  >
                    Konkrétnímu zaměstnanci
                  </Label>
                </div>
              </RadioGroup>
              {assignMode === "single" ? (
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={assignEmployeeId}
                  onChange={(e) => setAssignEmployeeId(e.target.value)}
                  aria-label="Zaměstnanec"
                >
                  <option value="">— vyberte —</option>
                  {(employeesList as {
                    id?: string;
                    firstName?: string;
                    lastName?: string;
                  }[])
                    .filter((e) => e?.id)
                    .map((e) => (
                      <option key={String(e.id)} value={String(e.id)}>
                        {`${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() ||
                          e.id}
                      </option>
                    ))}
                </select>
              ) : null}
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                Zrušit
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void saveTask()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
          {tasksLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" /> Načítám úkoly…
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  Nevyřízené ({openList.filter((t) => visibleTasks.some((v) => v.id === t.id)).length})
                </h3>
                <ul className="space-y-2">
                  {visibleTasks.filter((t) => isTaskOpen(t)).length === 0 ? (
                    <li className="text-sm text-muted-foreground">
                      Žádné nevyřízené úkoly.
                    </li>
                  ) : (
                    visibleTasks
                      .filter((t) => isTaskOpen(t))
                      .map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-start gap-3 rounded-lg border border-red-200 bg-red-50/80 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/30"
                        >
                          <Checkbox
                            checked={!isTaskOpen(t)}
                            onCheckedChange={() => void toggleDone(t)}
                            aria-label="Označit jako vyřízené"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900">{t.title}</p>
                            {t.description ? (
                              <p className="text-sm text-slate-800 mt-0.5 whitespace-pre-wrap">
                                {t.description}
                              </p>
                            ) : null}
                            <p className="text-xs text-slate-800 mt-1 space-x-2">
                              <span>Termín: {formatDueCs(t.dueDate)}</span>
                              <span>·</span>
                              <span>
                                Priorita:{" "}
                                {jobTaskPriorityLabel(
                                  (t.priority as JobTaskPriority) ?? "low"
                                )}
                              </span>
                            </p>
                            <p className="text-xs text-slate-800 mt-1">
                              Vytvořeno: {formatTaskDate(t.createdAt)} ·{" "}
                              {organizationTaskIsForAll(t)
                                ? "Přiřazeno: Všem"
                                : `Přiřazeno: ${employeeNameById.get(String(t.assignedTo)) ?? t.assignedTo}`}
                            </p>
                          </div>
                          {canManage ? (
                            <div className="flex gap-1 shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9"
                                onClick={() => openEdit(t)}
                                aria-label="Upravit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-destructive"
                                onClick={() => void removeTask(t.id)}
                                aria-label="Smazat"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))
                  )}
                </ul>
              </section>

              {doneList.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2">
                    Vyřízené (skryté z přehledu)
                  </h3>
                  <ul className="space-y-2">
                    {visibleTasks
                      .filter((t) => !isTaskOpen(t))
                      .map((t) => (
                        <li
                          key={t.id}
                          className="flex flex-wrap items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 opacity-90"
                        >
                          <Checkbox
                            checked={!isTaskOpen(t)}
                            onCheckedChange={() => void toggleDone(t)}
                            aria-label="Označit jako nevyřízené"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium line-through text-slate-800">
                              {t.title}
                            </p>
                            <p className="text-xs text-slate-800 mt-1">
                              {formatTaskDate(t.completedAt)}
                            </p>
                          </div>
                          {canManage ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 text-destructive"
                              onClick={() => void removeTask(t.id)}
                              aria-label="Smazat"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}
