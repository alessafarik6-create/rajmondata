"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  type Firestore,
} from "firebase/firestore";
import {
  useCollection,
  useMemoFirebase,
} from "@/firebase";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { NATIVE_SELECT_CLASS } from "@/lib/light-form-control-classes";
import {
  JOB_ROLE_ON_SITE_OPTIONS,
  memberPermissionsForAccessMode,
  syncJobEmployeeSummary,
  type JobAccessMode,
  type JobRoleOnSite,
} from "@/lib/job-employee-access";
import { cn } from "@/lib/utils";

type EmployeeRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  authUserId?: string;
};

type JobMemberRow = {
  id: string;
  employeeId?: string;
  authUserId?: string;
  roleOnJob?: string;
  accessMode?: JobAccessMode;
};

export function JobEmployeeAssignmentsSection({
  firestore,
  companyId,
  jobId,
  user,
  jobRecord,
  canManage,
}: {
  firestore: Firestore | null;
  companyId: string;
  jobId: string;
  user: User | null;
  jobRecord: Record<string, unknown> | null | undefined;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [selEmp, setSelEmp] = useState("");
  const [roleOnJob, setRoleOnJob] = useState<JobRoleOnSite>("montaznik");
  const [accessMode, setAccessMode] = useState<JobAccessMode>("limited");

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
        ? collection(
            firestore,
            "companies",
            companyId,
            "jobs",
            jobId,
            "jobMembers"
          )
        : null,
    [firestore, companyId, jobId]
  );
  const { data: membersRaw, isLoading: memLoading } =
    useCollection(membersCol);

  const employees = useMemo(
    () =>
      (Array.isArray(employeesRaw) ? employeesRaw : []) as EmployeeRow[],
    [employeesRaw]
  );

  const members = useMemo(
    () =>
      (Array.isArray(membersRaw) ? membersRaw : []) as JobMemberRow[],
    [membersRaw]
  );

  const memberIdSet = useMemo(
    () => new Set(members.map((m) => m.id).filter(Boolean)),
    [members]
  );

  const refreshSummary = useCallback(async () => {
    if (!firestore || !companyId || !jobId || !jobRecord) return;
    try {
      await syncJobEmployeeSummary(
        firestore,
        companyId,
        jobId,
        jobRecord
      );
    } catch (e) {
      console.error("[JobEmployeeAssignments] sync summary", e);
    }
  }, [firestore, companyId, jobId, jobRecord]);

  const addMember = async () => {
    if (!firestore || !user || !selEmp || !canManage) return;
    const emp = employees.find((e) => e.id === selEmp);
    if (!emp) {
      toast({
        variant: "destructive",
        title: "Vyberte zaměstnance",
      });
      return;
    }
    setAdding(true);
    try {
      const perms = memberPermissionsForAccessMode(accessMode);
      await setDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "jobMembers",
          emp.id
        ),
        {
          employeeId: emp.id,
          authUserId: emp.authUserId ?? null,
          roleOnJob,
          accessMode,
          jobPermissions: perms,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        },
        { merge: true }
      );

      await updateDoc(
        doc(firestore, "companies", companyId, "employees", emp.id),
        {
          assignedJobIds: arrayUnion(jobId),
          updatedAt: serverTimestamp(),
        }
      );

      await updateDoc(
        doc(firestore, "companies", companyId, "jobs", jobId),
        {
          assignedEmployeeIds: emp.authUserId
            ? arrayUnion(emp.id, emp.authUserId)
            : arrayUnion(emp.id),
          updatedAt: serverTimestamp(),
        }
      );

      await refreshSummary();
      toast({
        title: "Zakázka byla přiřazena zaměstnanci",
        description: `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || emp.id,
      });
      setSelEmp("");
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Přiřazení se nezdařilo",
        description: "Zkuste to znovu nebo zkontrolujte pravidla Firestore.",
      });
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (m: JobMemberRow) => {
    if (!firestore || !user || !canManage || !m.id) return;
    if (!window.confirm("Odebrat přiřazení k zakázce?")) return;
    try {
      const empSnap = await getDoc(
        doc(firestore, "companies", companyId, "employees", m.id)
      );
      const authUid = empSnap.exists()
        ? (empSnap.data() as { authUserId?: string }).authUserId
        : undefined;

      await deleteDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "jobMembers",
          m.id
        )
      );

      await updateDoc(
        doc(firestore, "companies", companyId, "employees", m.id),
        {
          assignedJobIds: arrayRemove(jobId),
          updatedAt: serverTimestamp(),
        }
      );

      const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
      await updateDoc(jobRef, {
        assignedEmployeeIds: arrayRemove(m.id),
        updatedAt: serverTimestamp(),
      });
      if (authUid) {
        await updateDoc(jobRef, {
          assignedEmployeeIds: arrayRemove(authUid),
          updatedAt: serverTimestamp(),
        });
      }

      await refreshSummary();
      toast({ title: "Přístup byl odebrán" });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Odebrání se nezdařilo",
      });
    }
  };

  const updateMemberAccess = async (
    memberDocId: string,
    nextMode: JobAccessMode,
    nextRole: JobRoleOnSite
  ) => {
    if (!firestore || !user || !canManage) return;
    try {
      await setDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "jobs",
          jobId,
          "jobMembers",
          memberDocId
        ),
        {
          accessMode: nextMode,
          roleOnJob: nextRole,
          jobPermissions: memberPermissionsForAccessMode(nextMode),
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        },
        { merge: true }
      );
      await refreshSummary();
      toast({
        title: "Přístup zaměstnance byl upraven",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
      });
    }
  };

  if (!canManage) return null;

  return (
    <Card className={cn("border-slate-200 shadow-sm")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Přiřazení zaměstnanci
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {empLoading || memLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1 sm:col-span-2">
                <Label>Zaměstnanec</Label>
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={selEmp}
                  onChange={(e) => setSelEmp(e.target.value)}
                >
                  <option value="">— vyberte —</option>
                  {employees
                    .filter((e) => e.id && !memberIdSet.has(e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.companyName?.trim() ||
                          `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() ||
                          e.id}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Role na zakázce</Label>
                <select
                  className={NATIVE_SELECT_CLASS}
                  value={roleOnJob}
                  onChange={(e) =>
                    setRoleOnJob(e.target.value as JobRoleOnSite)
                  }
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
                  onChange={(e) =>
                    setAccessMode(e.target.value as JobAccessMode)
                  }
                >
                  <option value="limited">Omezený (bez financí)</option>
                  <option value="full_internal">Plný interní náhled</option>
                </select>
              </div>
            </div>
            <Button
              type="button"
              className="gap-2"
              disabled={adding || !selEmp}
              onClick={() => void addMember()}
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Přiřadit k zakázce
            </Button>

            <div className="border-t border-slate-200 pt-3 space-y-2">
              <p className="text-xs font-medium text-slate-600">
                Přiřazení (členské záznamy)
              </p>
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Zatím žádní — přiřazení přes výkaz (assignedJobIds) zůstává;
                  zde nastavíte režim „full_internal“ nebo omezený s viditelností
                  složek.
                </p>
              ) : (
                <ul className="space-y-2">
                  {members.map((m) => {
                    const emp = employees.find((e) => e.id === m.id);
                    const label =
                      emp?.companyName?.trim() ||
                      `${emp?.firstName ?? ""} ${emp?.lastName ?? ""}`.trim() ||
                      m.id;
                    return (
                      <li
                        key={m.id}
                        className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-end sm:justify-between"
                      >
                        <div className="space-y-1 min-w-0">
                          <p className="font-medium truncate">{label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            ID: {m.id}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 items-end">
                          <div className="space-y-1">
                            <Label className="text-[10px]">Role</Label>
                            <select
                              className={cn(NATIVE_SELECT_CLASS, "min-w-[9rem]")}
                              value={
                                (m.roleOnJob as JobRoleOnSite) ?? "montaznik"
                              }
                              onChange={(e) =>
                                void updateMemberAccess(
                                  m.id,
                                  (m.accessMode as JobAccessMode) ??
                                    "limited",
                                  e.target.value as JobRoleOnSite
                                )
                              }
                            >
                              {JOB_ROLE_ON_SITE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px]">Přístup</Label>
                            <select
                              className={cn(NATIVE_SELECT_CLASS, "min-w-[11rem]")}
                              value={
                                (m.accessMode as JobAccessMode) ?? "limited"
                              }
                              onChange={(e) =>
                                void updateMemberAccess(
                                  m.id,
                                  e.target.value as JobAccessMode,
                                  (m.roleOnJob as JobRoleOnSite) ?? "montaznik"
                                )
                              }
                            >
                              <option value="limited">Omezený</option>
                              <option value="full_internal">Plný interní</option>
                            </select>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => void removeMember(m)}
                            aria-label="Odebrat"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
