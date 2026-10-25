"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { collection, doc, getDoc } from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Crown, Loader2, Plus, Search, Trash2, Users } from "lucide-react";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import {
  JOB_ROLE_ON_SITE_OPTIONS,
  type JobAccessMode,
  type JobRoleOnSite,
} from "@/lib/job-employee-access";
import { cn } from "@/lib/utils";
import {
  filterEmployeesForAssignment,
  formatEmployeeDisplayName,
} from "@/lib/employee-active";
import { EmployeeInactiveBadge } from "@/components/employees/employee-inactive-badge";
import {
  assignEmployeeToJob,
  removeEmployeeFromJob,
  setJobLeadEmployee,
} from "@/lib/job-employee-assignments";

type EmployeeRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  authUserId?: string;
  jobTitle?: string;
  position?: string;
};

type JobMemberRow = {
  id: string;
  employeeId?: string;
  authUserId?: string;
  roleOnJob?: string;
  accessMode?: JobAccessMode;
  assignedAt?: string;
  workStartDate?: string | null;
  workEndDate?: string | null;
  isJobLead?: boolean;
};

function formatAssignedDate(iso?: string): string {
  if (!iso?.trim()) return "—";
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function employeePosition(emp: EmployeeRow | undefined): string {
  const t = String(emp?.jobTitle ?? emp?.position ?? "").trim();
  return t || "—";
}

export function JobEmployeeAssignmentsSection({
  firestore,
  companyId,
  jobId,
  user,
  jobRecord,
  canManage,
  embedded = false,
}: {
  firestore: import("firebase/firestore").Firestore | null;
  companyId: string;
  jobId: string;
  user: User | null;
  jobRecord: Record<string, unknown> | null | undefined;
  canManage: boolean;
  /** Bez vnější Card — pro vložení do dashboardu zakázky */
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [roleOnJob, setRoleOnJob] = useState<JobRoleOnSite>("montaznik");
  const [accessMode, setAccessMode] = useState<JobAccessMode>("limited");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const jobLeadId =
    typeof jobRecord?.jobLeadEmployeeId === "string"
      ? jobRecord.jobLeadEmployeeId
      : null;

  const employeesCol = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "employees")
        : null,
    [firestore, companyId]
  );
  const { data: employeesRaw, isLoading: empLoading } =
    useCollection(employeesCol);

  const membersCol = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? collection(firestore, "companies", companyId, "jobs", jobId, "jobMembers")
        : null,
    [firestore, companyId, jobId]
  );
  const { data: membersRaw, isLoading: memLoading } = useCollection(membersCol);

  const employees = useMemo(
    () => (Array.isArray(employeesRaw) ? employeesRaw : []) as EmployeeRow[],
    [employeesRaw]
  );

  const employeesForAdd = useMemo(
    () => filterEmployeesForAssignment(employees),
    [employees]
  );

  const members = useMemo(
    () => (Array.isArray(membersRaw) ? membersRaw : []) as JobMemberRow[],
    [membersRaw]
  );

  const memberIdSet = useMemo(
    () => new Set(members.map((m) => m.id).filter(Boolean)),
    [members]
  );

  const assignCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employeesForAdd
      .filter((e) => e.id && !memberIdSet.has(e.id))
      .filter((e) => {
        if (!q) return true;
        const label = formatEmployeeDisplayName(e, e.id).toLowerCase();
        const pos = employeePosition(e).toLowerCase();
        return label.includes(q) || pos.includes(q) || e.id.toLowerCase().includes(q);
      });
  }, [employeesForAdd, memberIdSet, search]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmAssign = async () => {
    if (!firestore || !user || !canManage || !jobRecord || picked.size === 0) return;
    setAdding(true);
    try {
      for (const empId of picked) {
        const emp = employees.find((e) => e.id === empId);
        if (!emp) continue;
        await assignEmployeeToJob({
          firestore,
          companyId,
          jobId,
          jobRecord,
          employeeId: emp.id,
          authUserId: emp.authUserId ?? null,
          roleOnJob,
          accessMode,
          updatedByUid: user.uid,
        });
      }
      toast({
        title: picked.size === 1 ? "Zaměstnanec přiřazen" : "Zaměstnanci přiřazeni",
        description: `${picked.size} osob`,
      });
      setPicked(new Set());
      setAssignOpen(false);
      setSearch("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Přiřazení se nezdařilo",
      });
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (m: JobMemberRow) => {
    if (!firestore || !user || !canManage || !m.id || !jobRecord) return;
    if (!window.confirm("Odebrat zaměstnance z aktivního přiřazení k zakázce? Historie výkazů zůstane zachována.")) {
      return;
    }
    setBusyId(m.id);
    try {
      const empSnap = await getDoc(
        doc(firestore, "companies", companyId, "employees", m.id)
      );
      const authUid = empSnap.exists()
        ? (empSnap.data() as { authUserId?: string }).authUserId
        : undefined;
      await removeEmployeeFromJob({
        firestore,
        companyId,
        jobId,
        jobRecord,
        employeeId: m.id,
        authUserId: authUid,
      });
      toast({ title: "Přiřazení odebráno" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Odebrání se nezdařilo" });
    } finally {
      setBusyId(null);
    }
  };

  const makeLead = useCallback(
    async (employeeId: string) => {
      if (!firestore || !canManage || !membersCol) return;
      const refs = members.map((m) =>
        doc(firestore, "companies", companyId, "jobs", jobId, "jobMembers", m.id)
      );
      try {
        await setJobLeadEmployee(firestore, companyId, jobId, employeeId, refs);
        toast({ title: "Vedoucí zakázky nastaven" });
      } catch (e) {
        console.error(e);
        toast({ variant: "destructive", title: "Uložení vedoucího se nezdařilo" });
      }
    },
    [firestore, canManage, membersCol, members, companyId, jobId, toast]
  );

  const body = (
    <div className="space-y-4 text-sm">
      {empLoading || memLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {canManage ? (
            <Button
              type="button"
              className="gap-2 w-full sm:w-auto"
              onClick={() => setAssignOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Přiřadit zaměstnance
            </Button>
          ) : null}

          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Žádní pracovníci nejsou přiřazeni.
            </p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const emp = employees.find((e) => e.id === m.id);
                const label = formatEmployeeDisplayName(emp, m.id);
                const isLead = jobLeadId === m.id || m.isJobLead === true;
                return (
                  <li
                    key={m.id}
                    className="rounded-md border border-slate-200 p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium flex flex-wrap items-center gap-2">
                          {label}
                          {isLead ? (
                            <Badge variant="secondary" className="gap-1 text-[10px]">
                              <Crown className="h-3 w-3" />
                              Vedoucí zakázky
                            </Badge>
                          ) : null}
                          <EmployeeInactiveBadge employee={emp} />
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pozice: {employeePosition(emp)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Role:{" "}
                          {JOB_ROLE_ON_SITE_OPTIONS.find((o) => o.value === m.roleOnJob)?.label ??
                            m.roleOnJob ??
                            "—"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Přiřazeno: {formatAssignedDate(m.assignedAt)}
                        </p>
                        {(m.workStartDate || m.workEndDate) && (
                          <p className="text-[11px] text-muted-foreground">
                            Práce: {m.workStartDate || "—"} → {m.workEndDate || "—"}
                          </p>
                        )}
                      </div>
                      {canManage ? (
                        <div className="flex flex-wrap gap-1">
                          {!isLead ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => void makeLead(m.id)}
                            >
                              Vedoucí
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive h-8 w-8"
                            disabled={busyId === m.id}
                            onClick={() => void removeMember(m)}
                            aria-label="Odebrat"
                          >
                            {busyId === m.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Přiřadit zaměstnance k zakázce</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Hledat podle jména nebo pozice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Role na zakázce</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={roleOnJob}
                onChange={(e) => setRoleOnJob(e.target.value as JobRoleOnSite)}
              >
                {JOB_ROLE_ON_SITE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Režim přístupu</Label>
              <select
                className={NATIVE_SELECT_CLASS}
                value={accessMode}
                onChange={(e) => setAccessMode(e.target.value as JobAccessMode)}
              >
                <option value="limited">Omezený (bez financí)</option>
                <option value="full_internal">Plný interní náhled</option>
              </select>
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto border rounded-md divide-y min-h-[8rem]">
            {assignCandidates.length === 0 ? (
              <li className="p-4 text-xs text-muted-foreground text-center">
                Žádní zaměstnanci k výběru.
              </li>
            ) : (
              assignCandidates.map((e) => (
                <li key={e.id} className="flex items-center gap-3 p-2 hover:bg-muted/40">
                  <Checkbox
                    checked={picked.has(e.id)}
                    onCheckedChange={() => togglePick(e.id)}
                    id={`pick-${e.id}`}
                  />
                  <label htmlFor={`pick-${e.id}`} className="flex-1 cursor-pointer min-w-0">
                    <span className="font-medium block truncate">
                      {formatEmployeeDisplayName(e, e.id)}
                    </span>
                    <span className="text-xs text-muted-foreground">{employeePosition(e)}</span>
                  </label>
                </li>
              ))
            )}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)}>
              Zrušit
            </Button>
            <Button
              type="button"
              disabled={adding || picked.size === 0}
              onClick={() => void confirmAssign()}
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Přiřadit ({picked.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <Card className={cn("border-slate-200 shadow-sm")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Přiřazení pracovníci
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
