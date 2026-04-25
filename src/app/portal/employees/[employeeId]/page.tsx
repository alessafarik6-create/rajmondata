"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCompany,
  useCollection,
  useDoc,
  useFirestore,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { getFirebaseStorage } from "@/firebase/storage";
import {
  EMPTY_EMPLOYEE_BANK_ACCOUNT,
  parseBankAccountFromFirestore,
  validateEmployeeBankAccountInput,
  type EmployeeBankAccount,
} from "@/lib/employee-bank-account";
import {
  generateRandomTerminalPin,
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";
import { cn } from "@/lib/utils";
import { EmployeeDocumentsSection } from "@/components/portal/EmployeeDocumentsSection";
import { EmployeeGenerateDocumentDialog } from "@/components/portal/EmployeeGenerateDocumentDialog";
import {
  JOB_ROLE_ON_SITE_OPTIONS,
  memberPermissionsForAccessMode,
  type JobAccessMode,
  type JobRoleOnSite,
} from "@/lib/job-employee-access";
import { Loader2, ArrowLeft, Save, Upload, UserX } from "lucide-react";

function employeeDisplayName(e: Record<string, unknown> | null | undefined): string {
  if (!e) return "Zaměstnanec";
  const first = String(e.firstName ?? "").trim();
  const last = String(e.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || String(e.email ?? "").trim() || "Zaměstnanec";
}

function employeeTerminalStatus(e: Record<string, unknown> | null | undefined): {
  hasPin: boolean;
  needsChange: boolean;
} {
  const pinActive = e?.terminalPinActive;
  const legacy = e?.attendancePin;
  const hasPin =
    pinActive === true ||
    (pinActive !== false && legacy != null && String(legacy).trim().length > 0);
  return {
    hasPin,
    needsChange: e?.terminalPinNeedsChange === true,
  };
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams<{ employeeId: string }>();
  const employeeId = String(params?.employeeId ?? "").trim();

  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName, company } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc<any>(userRef);
  const companyId = profile?.companyId as string | undefined;

  const employeeRef = useMemoFirebase(
    () =>
      firestore && companyId && employeeId
        ? doc(firestore, "companies", companyId, "employees", employeeId)
        : null,
    [firestore, companyId, employeeId]
  );
  const { data: employeeDoc, isLoading: employeeLoading, error: employeeError } =
    useDoc<Record<string, unknown>>(employeeRef);

  const [savingStatus, setSavingStatus] = useState(false);
  const isActive =
    employeeDoc?.isActive == null ? true : Boolean(employeeDoc?.isActive);

  const terminal = useMemo(() => employeeTerminalStatus(employeeDoc), [employeeDoc]);

  const canManage = useMemo(() => {
    const role = String(profile?.role ?? "").trim();
    return ["owner", "admin", "manager", "accountant", "super_admin"].includes(role);
  }, [profile?.role]);

  const display = useMemo(() => employeeDisplayName(employeeDoc), [employeeDoc]);

  const photoUrl = useMemo(() => {
    const e = employeeDoc as Record<string, unknown> | null | undefined;
    return (
      String(e?.photoURL ?? e?.profileImage ?? e?.photoUrl ?? "").trim() || ""
    );
  }, [employeeDoc]);

  const initials = useMemo(() => {
    const f = String(employeeDoc?.firstName ?? "").trim();
    const l = String(employeeDoc?.lastName ?? "").trim();
    const a = f ? f[0] : "";
    const b = l ? l[0] : "";
    return (a + b).toUpperCase() || "Z";
  }, [employeeDoc]);

  const toggleActive = async () => {
    if (!canManage || !employeeRef || savingStatus) return;
    setSavingStatus(true);
    try {
      await updateDoc(employeeRef, {
        isActive: !isActive,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingStatus(false);
    }
  };

  // ------- editable forms (admin) -------
  const [tab, setTab] = useState<
    | "overview"
    | "personal"
    | "work"
    | "terminal"
    | "roles"
    | "jobs"
    | "documents"
    | "contracts"
    | "photos"
    | "signatures"
  >("overview");

  const [personalForm, setPersonalForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    note: "",
    jobTitle: "",
  });
  const [workForm, setWorkForm] = useState({
    hourlyRate: "",
    wageType: "hourly" as "hourly" | "monthly" | "other",
  });
  const [bankForm, setBankForm] = useState<EmployeeBankAccount>({
    ...EMPTY_EMPLOYEE_BANK_ACCOUNT,
  });

  useEffect(() => {
    if (!employeeDoc) return;
    setPersonalForm({
      firstName: String(employeeDoc.firstName ?? ""),
      lastName: String(employeeDoc.lastName ?? ""),
      email: String(employeeDoc.email ?? ""),
      phone: String(employeeDoc.phone ?? employeeDoc.phoneNumber ?? ""),
      address: String((employeeDoc as any).address ?? ""),
      note: String((employeeDoc as any).note ?? (employeeDoc as any).notes ?? ""),
      jobTitle: String((employeeDoc as any).jobTitle ?? (employeeDoc as any).position ?? ""),
    });
    setWorkForm({
      hourlyRate:
        employeeDoc.hourlyRate != null && employeeDoc.hourlyRate !== ""
          ? String(employeeDoc.hourlyRate)
          : "",
      wageType:
        (String((employeeDoc as any).wageType ?? "hourly") as any) === "monthly"
          ? "monthly"
          : (String((employeeDoc as any).wageType ?? "hourly") as any) === "other"
            ? "other"
            : "hourly",
    });
    const parsed = parseBankAccountFromFirestore((employeeDoc as any).bankAccount);
    setBankForm(parsed ? { ...parsed } : { ...EMPTY_EMPLOYEE_BANK_ACCOUNT });
  }, [employeeDoc]);

  const [savingPersonal, setSavingPersonal] = useState(false);
  const savePersonal = async () => {
    if (!canManage || !employeeRef || savingPersonal) return;
    setSavingPersonal(true);
    try {
      await updateDoc(employeeRef, {
        firstName: personalForm.firstName.trim(),
        lastName: personalForm.lastName.trim(),
        email: personalForm.email.trim(),
        phone: personalForm.phone.trim(),
        address: personalForm.address.trim(),
        jobTitle: personalForm.jobTitle.trim(),
        note: personalForm.note.trim(),
        updatedAt: serverTimestamp(),
      } as DocumentData);
      toast({ title: "Uloženo", description: "Osobní údaje byly aktualizovány." });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení selhalo" });
    } finally {
      setSavingPersonal(false);
    }
  };

  const [savingWork, setSavingWork] = useState(false);
  const saveWork = async () => {
    if (!canManage || !employeeRef || savingWork) return;
    const hr = workForm.hourlyRate.trim();
    const hrNum = hr ? Number(hr.replace(",", ".")) : null;
    if (hr && (!Number.isFinite(hrNum) || (hrNum as number) < 0)) {
      toast({ variant: "destructive", title: "Neplatná hodinová sazba" });
      return;
    }
    setSavingWork(true);
    try {
      await updateDoc(employeeRef, {
        hourlyRate: hrNum == null ? deleteField() : hrNum,
        wageType: workForm.wageType,
        updatedAt: serverTimestamp(),
      } as DocumentData);
      toast({ title: "Uloženo", description: "Práce a mzda byly aktualizovány." });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení selhalo" });
    } finally {
      setSavingWork(false);
    }
  };

  const [savingBank, setSavingBank] = useState(false);
  const saveBank = async () => {
    if (!canManage || !user || !companyId || !employeeId || savingBank) return;
    const v = validateEmployeeBankAccountInput(bankForm);
    if (!v.ok) {
      toast({ variant: "destructive", title: "Neplatné bankovní údaje", description: v.message });
      return;
    }
    setSavingBank(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/bank-account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId,
          bankAccount: v.normalized,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Uložení selhalo.");
      }
      toast({ title: "Uloženo", description: "Bankovní účet pro výplatu byl uložen." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Chyba", description: e?.message || "Zkuste to znovu." });
    } finally {
      setSavingBank(false);
    }
  };

  // profile photo
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const uploadPhoto = async () => {
    if (!canManage || !employeeRef || !photoFile) return;
    setPhotoBusy(true);
    try {
      const sp = `companies/${companyId}/employees/${employeeId}/profile/photo_${Date.now()}.jpg`;
      const r = storageRef(getFirebaseStorage(), sp);
      await uploadBytes(r, photoFile, {
        contentType: photoFile.type || "image/jpeg",
      });
      const url = await getDownloadURL(r);
      await updateDoc(employeeRef, {
        photoURL: url,
        profileImage: url,
        photoUrl: url,
        photoStoragePath: sp,
        updatedAt: serverTimestamp(),
      } as DocumentData);
      toast({ title: "Fotka uložena" });
      setPhotoFile(null);
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Upload selhal" });
    } finally {
      setPhotoBusy(false);
    }
  };

  const clearPhoto = async () => {
    if (!canManage || !employeeRef) return;
    setPhotoBusy(true);
    try {
      const sp = String((employeeDoc as any)?.photoStoragePath ?? "").trim();
      if (sp) {
        try {
          await deleteObject(storageRef(getFirebaseStorage(), sp));
        } catch {
          /* ignore */
        }
      }
      await updateDoc(employeeRef, {
        photoURL: deleteField(),
        profileImage: deleteField(),
        photoUrl: deleteField(),
        photoStoragePath: deleteField(),
        updatedAt: serverTimestamp(),
      } as DocumentData);
      toast({ title: "Fotka odstraněna" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Operace selhala" });
    } finally {
      setPhotoBusy(false);
    }
  };

  // roles & portal modules via existing API
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgRole, setOrgRole] = useState<"employee" | "orgAdmin">("employee");
  const [visibleInTerminal, setVisibleInTerminal] = useState(true);
  const [canWh, setCanWh] = useState(false);
  const [canProd, setCanProd] = useState(false);
  const [canMeet, setCanMeet] = useState(false);
  const [pmZakazky, setPmZakazky] = useState(true);
  const [pmPenize, setPmPenize] = useState(true);
  const [pmZpravy, setPmZpravy] = useState(true);
  const [pmDochazka, setPmDochazka] = useState(true);

  useEffect(() => {
    if (!employeeDoc) return;
    const r = String((employeeDoc as any).role ?? "employee") as "employee" | "orgAdmin";
    setOrgRole(r === "orgAdmin" ? "orgAdmin" : "employee");
    setVisibleInTerminal((employeeDoc as any).visibleInAttendanceTerminal !== false);
    setCanWh((employeeDoc as any).canAccessWarehouse === true);
    setCanProd((employeeDoc as any).canAccessProduction === true);
    setCanMeet((employeeDoc as any).canAccessMeetingNotes === true);
    const pm = (employeeDoc as any).employeePortalModules as any;
    setPmZakazky(pm?.zakazky !== false);
    setPmPenize(pm?.penize !== false);
    setPmZpravy(pm?.zpravy !== false);
    setPmDochazka(pm?.dochazka !== false);
  }, [employeeDoc]);

  const saveOrg = async () => {
    if (!canManage || !user || orgSaving) return;
    setOrgSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/update-org", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId,
          role: orgRole,
          visibleInAttendanceTerminal: visibleInTerminal,
          canAccessWarehouse: canWh,
          canAccessProduction: canProd,
          canAccessMeetingNotes: canMeet,
          employeePortalModules: {
            zakazky: pmZakazky === true,
            penize: pmPenize === true,
            zpravy: pmZpravy === true,
            dochazka: pmDochazka === true,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Uložení se nezdařilo.");
      }
      toast({ title: "Uloženo", description: "Role a oprávnění byly aktualizovány." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Chyba", description: e?.message || "Zkuste to znovu." });
    } finally {
      setOrgSaving(false);
    }
  };

  // terminal PIN via existing API
  const [pinBusy, setPinBusy] = useState(false);
  const [pinManual, setPinManual] = useState("");
  const callPinAdmin = async (action: "set" | "generate" | "clear") => {
    if (!canManage || !user || pinBusy) return;
    const pin =
      action === "set"
        ? normalizeTerminalPin(pinManual)
        : action === "generate"
          ? normalizeTerminalPin(generateRandomTerminalPin(4))
          : "";
    if (action === "set") {
      const err = validateTerminalPinFormat(pin);
      if (err) {
        toast({ variant: "destructive", title: err });
        return;
      }
    }
    setPinBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/terminal-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId,
          companyId,
          action,
          pin: action === "set" ? pin : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Operace selhala.");
      toast({ title: "Hotovo", description: data.message || "PIN aktualizován." });
      if (typeof data.generatedPin === "string" && data.generatedPin) {
        setPinManual(data.generatedPin);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Chyba", description: e?.message || "Zkuste to znovu." });
    } finally {
      setPinBusy(false);
    }
  };

  // assigned jobs (two-way sync with jobs.assignedEmployeeIds + jobMembers)
  const jobsCol = useMemoFirebase(
    () => (firestore && companyId ? collection(firestore, "companies", companyId, "jobs") : null),
    [firestore, companyId]
  );
  const { data: jobsRaw = [] } = useCollection<any>(jobsCol, {
    suppressGlobalPermissionError: true as const,
  });

  const companyJobs = useMemo(() => {
    const raw = Array.isArray(jobsRaw) ? jobsRaw : [];
    return raw
      .map((j: any) => ({
        id: String(j?.id ?? ""),
        name: String(j?.name ?? j?.title ?? "").trim(),
      }))
      .filter((j) => j.id)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [jobsRaw]);

  const [assignedJobIds, setAssignedJobIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const raw = (employeeDoc as any)?.assignedWorklogJobIds;
    const list = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
    setAssignedJobIds(new Set(list));
  }, [employeeDoc]);

  const [jobsSaving, setJobsSaving] = useState(false);
  const toggleAssignedJob = (jobId: string) => {
    setAssignedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const saveAssignedJobs = async () => {
    if (!canManage || !firestore || !companyId || !employeeId || jobsSaving) return;
    const before = new Set<string>(
      Array.isArray((employeeDoc as any)?.assignedWorklogJobIds)
        ? ((employeeDoc as any).assignedWorklogJobIds as any[]).map(String).filter(Boolean)
        : []
    );
    const after = new Set<string>(Array.from(assignedJobIds));
    const added: string[] = [];
    const removed: string[] = [];
    for (const j of after) if (!before.has(j)) added.push(j);
    for (const j of before) if (!after.has(j)) removed.push(j);

    setJobsSaving(true);
    try {
      const empRef = doc(firestore, "companies", companyId, "employees", employeeId);
      const byId: Record<string, string> = {};
      for (const j of companyJobs) {
        if (after.has(j.id)) byId[j.id] = j.name || j.id;
      }

      const batch = writeBatch(firestore);

      // employee doc (for worklogs + legacy)
      batch.update(empRef, {
        assignedJobIds: Array.from(after),
        assignedWorklogJobIds: Array.from(after),
        assignedWorklogJobsById: byId,
        updatedAt: serverTimestamp(),
      } as DocumentData);

      const authUserId =
        typeof (employeeDoc as any)?.authUserId === "string" && String((employeeDoc as any).authUserId).trim()
          ? String((employeeDoc as any).authUserId).trim()
          : null;

      // sync jobs + jobMembers
      for (const jobId of added) {
        const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
        batch.update(jobRef, {
          assignedEmployeeIds: authUserId ? arrayUnion(employeeId, authUserId) : arrayUnion(employeeId),
          updatedAt: serverTimestamp(),
        } as DocumentData);
        // default jobMembers (limited)
        const accessMode: JobAccessMode = "limited";
        const roleOnJob: JobRoleOnSite = "montaznik";
        const perms = memberPermissionsForAccessMode(accessMode);
        batch.set(
          doc(firestore, "companies", companyId, "jobs", jobId, "jobMembers", employeeId),
          {
            employeeId,
            authUserId: authUserId,
            roleOnJob,
            accessMode,
            jobPermissions: perms,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: user?.uid ?? null,
          },
          { merge: true }
        );
      }

      for (const jobId of removed) {
        const jobRef = doc(firestore, "companies", companyId, "jobs", jobId);
        batch.update(jobRef, {
          assignedEmployeeIds: arrayRemove(employeeId),
          updatedAt: serverTimestamp(),
        } as DocumentData);
        if (authUserId) {
          batch.update(jobRef, {
            assignedEmployeeIds: arrayRemove(authUserId),
            updatedAt: serverTimestamp(),
          } as DocumentData);
        }
        batch.delete(
          doc(firestore, "companies", companyId, "jobs", jobId, "jobMembers", employeeId)
        );
      }

      await batch.commit();

      toast({
        title: "Uloženo",
        description: "Přiřazené zakázky byly synchronizovány i na zakázkách.",
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setJobsSaving(false);
    }
  };


  if (isUserLoading || profileLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-black">
        <Loader2 className="h-7 w-7 animate-spin" />
        Načítání…
      </div>
    );
  }

  if (!user || !companyId || !employeeId) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Chybí přístup</AlertTitle>
        <AlertDescription>
          Tuto stránku lze otevřít pouze po přihlášení v rámci organizace.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-2 pb-12 sm:px-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 border-slate-300"
              onClick={() => router.push("/portal/employees")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zaměstnanci
            </Button>
            <p className="text-sm text-slate-700">
              {companyName ? `${companyName} · ` : ""}Detail zaměstnance
            </p>
          </div>
          <h1 className="mt-2 break-words text-xl font-bold text-black sm:text-2xl">
            {display}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={isActive ? "default" : "secondary"}
            className="capitalize"
          >
            {isActive ? "Aktivní" : "Neaktivní"}
          </Badge>
          {canManage ? (
            <Button
              type="button"
              variant={isActive ? "destructive" : "default"}
              className="h-10"
              disabled={savingStatus}
              onClick={() => void toggleActive()}
            >
              {savingStatus ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserX className="mr-2 h-4 w-4" />
                  {isActive ? "Deaktivovat" : "Aktivovat"}
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {employeeError ? (
        <Alert variant="destructive">
          <AlertTitle>Nelze načíst zaměstnance</AlertTitle>
          <AlertDescription>
            Zkuste stránku obnovit. Pokud problém přetrvá, zkontrolujte oprávnění.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger value="overview" className="h-10">Přehled</TabsTrigger>
          <TabsTrigger value="personal" className="h-10">Osobní údaje</TabsTrigger>
          <TabsTrigger value="work" className="h-10">Práce a mzda</TabsTrigger>
          <TabsTrigger value="terminal" className="h-10">Terminál a PIN</TabsTrigger>
          <TabsTrigger value="roles" className="h-10">Role a oprávnění</TabsTrigger>
          <TabsTrigger value="jobs" className="h-10">Přiřazené zakázky</TabsTrigger>
          <TabsTrigger value="documents" className="h-10">Dokumenty</TabsTrigger>
          <TabsTrigger value="contracts" className="h-10">Smlouvy a dohody</TabsTrigger>
          <TabsTrigger value="photos" className="h-10">Fotodokumentace</TabsTrigger>
          <TabsTrigger value="signatures" className="h-10">Podpisy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg text-black">Přehled</CardTitle>
                <p className="text-sm text-slate-700">
                  Rychlý souhrn + stav. Úpravy jsou v dalších záložkách.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Avatar className="h-16 w-16 border border-slate-200">
                  <AvatarImage src={photoUrl || undefined} className="object-cover" alt="" />
                  <AvatarFallback className="bg-slate-100 text-slate-900">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
            </CardHeader>
            <CardContent>
              {employeeLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-800">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Načítání profilu…
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Jméno</Label>
                    <p className="font-medium text-black">{display}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">E-mail</Label>
                    <p className="font-medium text-black">{String(employeeDoc?.email ?? "—")}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Telefon</Label>
                    <p className="font-medium text-black">
                      {String(employeeDoc?.phone ?? employeeDoc?.phoneNumber ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Pozice</Label>
                    <p className="font-medium text-black">
                      {String((employeeDoc as any)?.jobTitle ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Hodinová sazba</Label>
                    <p className="font-medium text-black">
                      {(employeeDoc as any)?.hourlyRate != null ? `${String((employeeDoc as any).hourlyRate)} Kč/h` : "—"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Terminál</Label>
                    <p className="font-medium text-black">
                      {terminal.hasPin ? "PIN nastaven" : "Bez PINu"}
                      {terminal.needsChange ? " · změnit v profilu" : ""}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="personal" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Osobní údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex items-center gap-4">
                  <Avatar className="h-28 w-28 border border-slate-200">
                    <AvatarImage src={photoUrl || undefined} className="object-cover" alt="" />
                    <AvatarFallback className="bg-slate-100 text-slate-900 text-2xl">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="flex-1 space-y-2">
                  <Label className="text-sm text-black">Profilová fotka</Label>
                  <Input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    disabled={!canManage || photoBusy}
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="default" className="h-10" disabled={!canManage || photoBusy || !photoFile} onClick={() => void uploadPhoto()}>
                      {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      Nahrát
                    </Button>
                    <Button type="button" variant="outline" className="h-10" disabled={!canManage || photoBusy || !photoUrl} onClick={() => void clearPhoto()}>
                      Odebrat fotku
                    </Button>
                  </div>
                  <p className="text-xs text-slate-600">
                    Fotka se uloží do Firebase Storage a url se uloží do záznamu zaměstnance.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Jméno</Label>
                  <Input value={personalForm.firstName} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, firstName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Příjmení</Label>
                  <Input value={personalForm.lastName} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, lastName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input value={personalForm.email} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Telefon</Label>
                  <Input value={personalForm.phone} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Adresa</Label>
                  <Input value={personalForm.address} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Pracovní pozice</Label>
                  <Input value={personalForm.jobTitle} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Poznámka</Label>
                  <Textarea value={personalForm.note} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, note: e.target.value }))} className="min-h-[110px]" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" className="h-11" disabled={!canManage || savingPersonal} onClick={() => void savePersonal()}>
                  {savingPersonal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit osobní údaje
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Práce a mzda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Hodinová sazba (Kč/h)</Label>
                  <Input value={workForm.hourlyRate} disabled={!canManage} inputMode="decimal" onChange={(e) => setWorkForm((p) => ({ ...p, hourlyRate: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Typ mzdy</Label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" disabled={!canManage} value={workForm.wageType} onChange={(e) => setWorkForm((p) => ({ ...p, wageType: e.target.value as any }))}>
                    <option value="hourly">Hodinová</option>
                    <option value="monthly">Měsíční</option>
                    <option value="other">Jiné</option>
                  </select>
                  <p className="text-xs text-slate-600">
                    Pokud vaše aplikace typ mzdy dosud neměla, ukládá se do pole <code>wageType</code> na zaměstnanci.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold text-black">Bankovní účet (výplata)</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Číslo účtu</Label>
                    <Input value={bankForm.accountNumber} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, accountNumber: e.target.value }))} placeholder="např. 19-123456789" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kód banky</Label>
                    <Input value={bankForm.bankCode} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, bankCode: e.target.value }))} placeholder="např. 0100" />
                  </div>
                  <div className="space-y-2">
                    <Label>IBAN</Label>
                    <Input value={bankForm.iban} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, iban: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>BIC/SWIFT</Label>
                    <Input value={bankForm.bic} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, bic: e.target.value }))} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Poznámka k výplatě</Label>
                    <Textarea value={bankForm.paymentNote} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, paymentNote: e.target.value }))} />
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" className="h-11" disabled={!canManage || savingBank} onClick={() => void saveBank()}>
                    {savingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Uložit bankovní účet
                  </Button>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" className="h-11" disabled={!canManage || savingWork} onClick={() => void saveWork()}>
                  {savingWork ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit práci a mzdu
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="terminal" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Terminál a PIN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Stav</Label>
                  <p className="font-medium text-black">
                    {terminal.hasPin ? "PIN nastaven" : "Bez PINu"}{terminal.needsChange ? " · změnit v profilu" : ""}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>PIN (ručně nastavit)</Label>
                  <Input value={pinManual} disabled={!canManage || pinBusy} onChange={(e) => setPinManual(e.target.value)} placeholder="např. 1234" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="h-10" disabled={!canManage || pinBusy} onClick={() => void callPinAdmin("set")}>
                      Nastavit PIN
                    </Button>
                    <Button type="button" variant="outline" className="h-10" disabled={!canManage || pinBusy} onClick={() => void callPinAdmin("generate")}>
                      Vygenerovat PIN
                    </Button>
                    <Button type="button" variant="destructive" className="h-10" disabled={!canManage || pinBusy} onClick={() => void callPinAdmin("clear")}>
                      Reset / zrušit PIN
                    </Button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-600">
                PIN se ukládá jako hash do <code>employees/{employeeId}/private/terminal</code> přes Admin API.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Role a oprávnění</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Role v portálu</Label>
                  <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" disabled={!canManage} value={orgRole} onChange={(e) => setOrgRole(e.target.value as any)}>
                    <option value="employee">Zaměstnanec</option>
                    <option value="orgAdmin">Administrátor organizace</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                  <div>
                    <p className="text-sm font-medium text-black">Viditelný v docházkovém terminálu</p>
                    <p className="text-xs text-slate-600">Zaměstnanec se zobrazí pro přihlášení na terminálu.</p>
                  </div>
                  <Switch checked={visibleInTerminal} disabled={!canManage} onCheckedChange={(v) => setVisibleInTerminal(v)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-2 rounded-md border border-slate-200 p-3">
                  <Checkbox checked={canWh} disabled={!canManage} onCheckedChange={(v) => setCanWh(v === true)} />
                  <span className="text-sm text-black">Sklad</span>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-slate-200 p-3">
                  <Checkbox checked={canProd} disabled={!canManage} onCheckedChange={(v) => setCanProd(v === true)} />
                  <span className="text-sm text-black">Výroba</span>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-slate-200 p-3">
                  <Checkbox checked={canMeet} disabled={!canManage} onCheckedChange={(v) => setCanMeet(v === true)} />
                  <span className="text-sm text-black">Schůzky</span>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 p-4">
                <p className="text-sm font-semibold text-black">Oprávnění do portálu (moduly)</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={pmZakazky} disabled={!canManage} onCheckedChange={(v) => setPmZakazky(v === true)} />
                    <span className="text-sm text-black">Zakázky</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={pmPenize} disabled={!canManage} onCheckedChange={(v) => setPmPenize(v === true)} />
                    <span className="text-sm text-black">Peníze</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={pmZpravy} disabled={!canManage} onCheckedChange={(v) => setPmZpravy(v === true)} />
                    <span className="text-sm text-black">Zprávy</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox checked={pmDochazka} disabled={!canManage} onCheckedChange={(v) => setPmDochazka(v === true)} />
                    <span className="text-sm text-black">Docházka</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="button" className="h-11" disabled={!canManage || orgSaving} onClick={() => void saveOrg()}>
                  {orgSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit role a oprávnění
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg text-black">Přiřazené zakázky</CardTitle>
                <p className="text-sm text-slate-700">
                  Přiřazení se ukládá na zaměstnance i na zakázku a vytváří se i záznam v <code>jobMembers</code>.
                </p>
              </div>
              <Button type="button" className="h-11" disabled={!canManage || jobsSaving} onClick={() => void saveAssignedJobs()}>
                {jobsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Uložit přiřazení
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {companyJobs.length === 0 ? (
                <p className="text-sm text-slate-700">Žádné zakázky.</p>
              ) : (
                <div className="grid gap-2">
                  {companyJobs.map((j) => (
                    <label key={j.id} className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
                      <Checkbox
                        checked={assignedJobIds.has(j.id)}
                        disabled={!canManage}
                        onCheckedChange={() => toggleAssignedJob(j.id)}
                      />
                      <span className="text-sm text-black">{j.name || j.id}</span>
                      <span className="ml-auto text-xs text-slate-500">{j.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-4">
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="all"
            title="Dokumenty zaměstnance"
          />
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-700">
              Vygenerované PDF se automaticky uloží do dokumentů zaměstnance.
            </p>
            <EmployeeGenerateDocumentDialog
              companyId={companyId}
              employeeId={employeeId}
              canManage={canManage}
              company={company as Record<string, unknown> | null | undefined}
              employee={employeeDoc ?? undefined}
            />
          </div>
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="contracts"
            title="Smlouvy a dohody"
          />
        </TabsContent>

        <TabsContent value="photos" className="mt-4 space-y-4">
          <EmployeeDocumentsSection
            companyId={companyId}
            employeeId={employeeId}
            canManage={canManage}
            mode="photos"
            title="Fotodokumentace"
          />
        </TabsContent>

        <TabsContent value="signatures" className="mt-4 space-y-4">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-lg text-black">Podpisy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-slate-700">
                Podepisování bude navázané na vygenerované PDF dokumenty (zaměstnanec/firma).
              </p>
              <p className="text-xs text-slate-600">
                Podpis může být kreslený (canvas) nebo nahraný obrázek; finální podepsané PDF se uloží
                jako nová verze.
              </p>
              <p className="text-xs text-slate-600">
                Zpět do seznamu:{" "}
                <Link href="/portal/employees" className="underline underline-offset-2">
                  Zaměstnanci
                </Link>
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

