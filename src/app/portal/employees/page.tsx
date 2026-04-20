"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Plus, 
  Search, 
  Filter, 
  Download, 
  Loader2, 
  MoreVertical, 
  UserPlus,
  Shield,
  UserX,
  Trash2,
  Edit2,
  DollarSign,
  KeyRound,
  RefreshCw,
  Eye,
  Briefcase,
  AlertTriangle,
  Link2,
  Landmark,
} from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, useDoc } from '@/firebase';
import { collection, doc, deleteDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  parseAssignedWorklogJobIds,
  parseAssignedTerminalJobIds,
} from "@/lib/assigned-jobs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from '@/components/ui/label';
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
/** Světlý styl polí v modálu „Pozvat člena týmu“ (neovlivní zbytek portálu). */
const INVITE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base text-black ring-offset-0 placeholder:text-gray-600 focus-visible:border-orange-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:ring-offset-0 md:text-sm disabled:opacity-70";

const INVITE_SELECT_TRIGGER_CLASS =
  "flex h-10 w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-black ring-offset-0 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:ring-offset-0 disabled:opacity-70 [&>span]:line-clamp-1 [&>span]:text-black";

const INVITE_SELECT_CONTENT_CLASS =
  "bg-white text-black border border-gray-200";

const INVITE_SELECT_ITEM_CLASS =
  "cursor-pointer text-black focus:bg-gray-100 focus:text-black data-[highlighted]:bg-gray-100 data-[highlighted]:text-black";

const INVITE_LABEL_CLASS = "text-sm font-medium text-gray-700";
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";
import {
  releaseDocumentModalLocksAfterTransition,
} from "@/lib/release-modal-locks";
import {
  normalizeTerminalPin,
  validateTerminalPinFormat,
} from "@/lib/terminal-pin-validation";
import {
  isVisibleInAttendanceTerminal,
  parseEmployeeOrgRole,
} from "@/lib/employee-organization";
import {
  isDailyWorkLogEnabled,
  isWorkLogEnabled,
} from "@/lib/employee-report-flags";
import { parseEmployeePortalModules } from "@/lib/employee-portal-modules";
import {
  EMPTY_EMPLOYEE_BANK_ACCOUNT,
  maskBankAccountForListDisplay,
  parseBankAccountFromFirestore,
  type EmployeeBankAccount,
} from "@/lib/employee-bank-account";

function releaseModalLocksAfterDismiss() {
  releaseDocumentModalLocksAfterTransition(320);
}

/** Otevření dialogu hned po kliknutí v DropdownMenu koliduje s Radix focus/pointer-events — počkej na zavření menu. */
function runAfterDropdownMenuCloses(fn: () => void): void {
  if (typeof window === "undefined") {
    fn();
    return;
  }
  window.setTimeout(fn, 0);
}

/** Porovnání množin ID — zabrání zbytečným setState při stejném obsahu. */
function jobIdSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/** PIN docházky aktivní (hash v private nebo legacy pole attendancePin). */
function employeeTerminalPinActive(emp: Record<string, unknown>): boolean {
  if (emp.terminalPinActive === true) return true;
  if (emp.terminalPinActive === false) return false;
  const legacy = emp.attendancePin;
  return legacy != null && String(legacy).length > 0;
}

export default function EmployeesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const userRef = useMemoFirebase(
    () => (user ? doc(firestore, "users", user.uid) : null),
    [firestore, user?.uid]
  );
  const { data: profile } = useDoc(userRef);

  const companyId = profile?.companyId;
  const userRole = profile?.role || "employee";
  const isSuperAdmin =
    Array.isArray(profile?.globalRoles) &&
    profile.globalRoles.includes("super_admin");

  /** Plná správa (pozvánka, role, mazání…) — pouze vlastník / admin firmy. */
  const canManage = userRole === "owner" || userRole === "admin";
  /** Reset hesla v Auth — i super_admin u zaměstnanců vybrané firmy. */
  const canResetEmployeeAuthPassword =
    canManage || (isSuperAdmin && !!companyId);
  const canView =
    ["owner", "admin", "manager", "accountant"].includes(userRole) ||
    isSuperAdmin;

  /** Úplné bankovní údaje a jejich úprava (včetně účtu pro výplatu). */
  const canEditEmployeeBank =
    ["owner", "admin", "manager", "accountant"].includes(userRole) ||
    isSuperAdmin;

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId]);

  const { data: employees, isLoading } = useCollection(employeesQuery);

  const companyDocRef = useMemoFirebase(
    () =>
      firestore && companyId ? doc(firestore, "companies", companyId) : null,
    [firestore, companyId]
  );
  const { data: companyDoc } = useDoc(companyDocRef);

  const allowEmployeeBankAccountSelfEdit =
    companyDoc?.allowEmployeeBankAccountSelfEdit === true ||
    (typeof companyDoc?.settings === "object" &&
      companyDoc.settings !== null &&
      (companyDoc.settings as Record<string, unknown>)
        .allowEmployeeBankAccountSelfEdit === true);

  const [companySelfBankSaving, setCompanySelfBankSaving] = useState(false);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    orgRole: 'employee' as 'employee' | 'orgAdmin',
    visibleInAttendanceTerminal: true,
    jobTitle: '',
    hourlyRate: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [orgSettingsEmp, setOrgSettingsEmp] = useState<any | null>(null);
  const [orgSettingsRole, setOrgSettingsRole] = useState<'employee' | 'orgAdmin'>('employee');
  const [orgSettingsTerminalVisible, setOrgSettingsTerminalVisible] = useState(true);
  const [orgSettingsCanWarehouse, setOrgSettingsCanWarehouse] = useState(false);
  const [orgSettingsCanProduction, setOrgSettingsCanProduction] = useState(false);
  const [orgSettingsSaving, setOrgSettingsSaving] = useState(false);
  const [portalModZakazky, setPortalModZakazky] = useState(true);
  const [portalModPenize, setPortalModPenize] = useState(true);
  const [portalModZpravy, setPortalModZpravy] = useState(true);
  const [portalModDochazka, setPortalModDochazka] = useState(true);

  const [qrEmployee, setQrEmployee] = useState<any | null>(null);

  useEffect(() => {
    if (!profile) return;
    if (!canView) {
      if (userRole === "employee") {
        router.replace("/portal/employee");
        return;
      }
      toast({
        variant: "destructive",
        title: "Přístup odepřen",
        description: "Nemáte oprávnění k prohlížení seznamu zaměstnanců.",
      });
      router.push("/portal/dashboard");
    }
    // toast z useToast() má nestabilní referenci — v deps způsobuje zbytečné opakování efektu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, canView, userRole, router]);

  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState("");

  const [pwdResetEmployee, setPwdResetEmployee] = useState<any | null>(null);
  const [pwdResetNew, setPwdResetNew] = useState("");
  const [pwdResetConfirm, setPwdResetConfirm] = useState("");
  const [pwdResetLoading, setPwdResetLoading] = useState(false);

  const [terminalPinManualOpen, setTerminalPinManualOpen] = useState(false);
  const [terminalPinManualEmp, setTerminalPinManualEmp] = useState<any | null>(null);
  const [terminalPinManualValue, setTerminalPinManualValue] = useState("");
  const [terminalPinManualConfirm, setTerminalPinManualConfirm] = useState("");
  const [terminalPinManualSaving, setTerminalPinManualSaving] = useState(false);

  const [terminalPinGenerateOpen, setTerminalPinGenerateOpen] = useState(false);
  const [terminalPinGenerateEmp, setTerminalPinGenerateEmp] = useState<any | null>(null);
  const [terminalPinGenerateSaving, setTerminalPinGenerateSaving] = useState(false);
  /** Po úspěšném generate — zobrazíme PIN v dialogu (jednorázově). */
  const [terminalPinGeneratedDisplay, setTerminalPinGeneratedDisplay] = useState<string | null>(
    null
  );

  const [terminalPinClearOpen, setTerminalPinClearOpen] = useState(false);
  const [terminalPinClearEmp, setTerminalPinClearEmp] = useState<any | null>(null);
  const [terminalPinClearSaving, setTerminalPinClearSaving] = useState(false);

  const [hourlyRateEmp, setHourlyRateEmp] = useState<any | null>(null);
  const [hourlyRateInput, setHourlyRateInput] = useState("");
  const [hourlyRateSaving, setHourlyRateSaving] = useState(false);

  const [bankDialogEmp, setBankDialogEmp] = useState<Record<string, unknown> & { id?: string } | null>(null);
  const [bankForm, setBankForm] = useState<EmployeeBankAccount>({
    ...EMPTY_EMPLOYEE_BANK_ACCOUNT,
  });
  const [bankSaving, setBankSaving] = useState(false);

  const [assignWorklogEmployee, setAssignWorklogEmployee] = useState<any | null>(
    null
  );
  const [assignWorklogJobIds, setAssignWorklogJobIds] = useState<Set<string>>(
    new Set()
  );
  const [savingAssignedWorklogJobs, setSavingAssignedWorklogJobs] =
    useState(false);
  /** V dialogu „Zakázky pro výkaz práce“ — jeden přepínač pro denní výkaz i legacy výkaz (stejná hodnota). */
  const [enableUnifiedWorkReportToggle, setEnableUnifiedWorkReportToggle] =
    useState(true);

  const [assignTerminalEmployee, setAssignTerminalEmployee] = useState<any | null>(
    null
  );
  const [assignTerminalJobIds, setAssignTerminalJobIds] = useState<Set<string>>(
    new Set()
  );
  const [savingAssignedTerminalJobs, setSavingAssignedTerminalJobs] =
    useState(false);
  /** Dialog „Zakázky pro terminál“ — automatické schválení výdělku na zakázce. */
  const [autoApproveJobEarningsTerminal, setAutoApproveJobEarningsTerminal] =
    useState(false);

  /** Pouze id — celé objekty zaměstnance v deps useMemoFirebase rozbíjely stabilitu dotazu. */
  const assignJobsTargetId =
    assignWorklogEmployee?.id ?? assignTerminalEmployee?.id ?? null;

  const jobsForAssignQuery = useMemoFirebase(
    () =>
      firestore && companyId && assignJobsTargetId
        ? collection(firestore, "companies", companyId, "jobs")
        : null,
    [firestore, companyId, assignJobsTargetId]
  );
  const { data: companyJobsRaw, isLoading: companyJobsLoading } =
    useCollection(jobsForAssignQuery);

  const companyJobs = useMemo(() => {
    const raw = Array.isArray(companyJobsRaw) ? companyJobsRaw : [];
    return raw
      .map((j: any) => ({
        id: String(j?.id ?? ""),
        name: typeof j?.name === "string" ? j.name : "",
      }))
      .filter((j) => j.id)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, "cs"));
  }, [companyJobsRaw]);

  const worklogEmployeeId = assignWorklogEmployee?.id ?? null;
  const terminalEmployeeId = assignTerminalEmployee?.id ?? null;

  /**
   * Sync výběru zakázek z aktuálního Firestore snapshotu.
   * Nepoužívat celý objekt zaměstnance v deps — při každém onSnapshot má novou referenci
   * a efekt by se opakoval spolu s setState → zbytečné re-rendery / riziko zamrznutí UI.
   */
  useEffect(() => {
    if (!worklogEmployeeId) {
      setAssignWorklogJobIds((prev) => {
        if (prev.size === 0) return prev;
        return new Set();
      });
      return;
    }
    const fresh = employees?.find((e) => e.id === worklogEmployeeId);
    if (!fresh) return;
    const next = new Set(parseAssignedWorklogJobIds(fresh));
    setAssignWorklogJobIds((prev) => (jobIdSetsEqual(prev, next) ? prev : next));
  }, [worklogEmployeeId, employees]);

  useEffect(() => {
    if (!worklogEmployeeId) {
      setEnableUnifiedWorkReportToggle(true);
      return;
    }
    const fresh = employees?.find((e) => e.id === worklogEmployeeId) as
      | {
          enableDailyWorkLog?: boolean;
          enableWorkLog?: boolean;
        }
      | undefined;
    if (!fresh) return;
    const unified =
      isDailyWorkLogEnabled(fresh) || isWorkLogEnabled(fresh);
    setEnableUnifiedWorkReportToggle(unified);
  }, [worklogEmployeeId, employees]);

  useEffect(() => {
    if (!terminalEmployeeId) {
      setAssignTerminalJobIds((prev) => {
        if (prev.size === 0) return prev;
        return new Set();
      });
      return;
    }
    const fresh = employees?.find((e) => e.id === terminalEmployeeId);
    if (!fresh) return;
    const next = new Set(parseAssignedTerminalJobIds(fresh));
    setAssignTerminalJobIds((prev) => (jobIdSetsEqual(prev, next) ? prev : next));
  }, [terminalEmployeeId, employees]);

  useEffect(() => {
    if (!terminalEmployeeId) {
      setAutoApproveJobEarningsTerminal(false);
      return;
    }
    const fresh = employees?.find((e) => e.id === terminalEmployeeId) as
      | { autoApproveJobEarnings?: boolean }
      | undefined;
    if (!fresh) return;
    setAutoApproveJobEarningsTerminal(fresh.autoApproveJobEarnings === true);
  }, [terminalEmployeeId, employees]);

  const toggleAssignWorklogJob = (jobId: string) => {
    setAssignWorklogJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleAssignTerminalJob = (jobId: string) => {
    setAssignTerminalJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const saveAssignedWorklogJobs = async () => {
    if (!canManage || !companyId || !assignWorklogEmployee?.id) return;
    setSavingAssignedWorklogJobs(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "employees",
          assignWorklogEmployee.id
        ),
        {
          assignedWorklogJobIds: Array.from(assignWorklogJobIds),
          enableDailyWorkLog: Boolean(enableUnifiedWorkReportToggle),
          enableWorkLog: Boolean(enableUnifiedWorkReportToggle),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Uloženo",
        description: "Zakázky pro výkaz práce byly aktualizovány.",
      });
      setAssignWorklogEmployee(null);
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingAssignedWorklogJobs(false);
    }
  };

  const saveAssignedTerminalJobs = async () => {
    if (!canManage || !companyId || !assignTerminalEmployee?.id) return;
    setSavingAssignedTerminalJobs(true);
    try {
      await updateDoc(
        doc(
          firestore,
          "companies",
          companyId,
          "employees",
          assignTerminalEmployee.id
        ),
        {
          assignedTerminalJobIds: Array.from(assignTerminalJobIds),
          autoApproveJobEarnings: Boolean(autoApproveJobEarningsTerminal),
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Uloženo",
        description: "Zakázky pro veřejné přihlášení docházky byly aktualizovány.",
      });
      setAssignTerminalEmployee(null);
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingAssignedTerminalJobs(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !companyId || !user) return;

    if (invitePassword.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
      toast({
        variant: "destructive",
        title: "Slabé heslo",
        description: `Heslo pro přihlášení musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`,
      });
      return;
    }
    if (invitePassword !== invitePasswordConfirm) {
      toast({
        variant: "destructive",
        title: "Hesla se neshodují",
        description: "Zkontrolujte pole heslo a potvrzení.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const rateStr = inviteData.hourlyRate.trim();
      const hourlyRate =
        rateStr === "" ? null : Number(rateStr);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/create-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          firstName: inviteData.firstName.trim(),
          lastName: inviteData.lastName.trim(),
          email: inviteData.email.trim().toLowerCase(),
          password: invitePassword,
          jobTitle: inviteData.jobTitle.trim(),
          hourlyRate:
            hourlyRate != null && !Number.isNaN(hourlyRate) ? hourlyRate : null,
          role: inviteData.orgRole,
          visibleInAttendanceTerminal: inviteData.visibleInAttendanceTerminal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Vytvoření účtu selhalo."
        );
      }

      toast({
        title: "Zaměstnanec přidán",
        description:
          data.message ||
          `${inviteData.firstName} má účet a přístup do zaměstnaneckého portálu.`,
      });
      setIsInviteOpen(false);
      setInviteData({
        firstName: "",
        lastName: "",
        email: "",
        orgRole: "employee",
        visibleInAttendanceTerminal: true,
        jobTitle: "",
        hourlyRate: "",
      });
      setInvitePassword("");
      setInvitePasswordConfirm("");
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Nepodařilo se přidat zaměstnance.";
      toast({
        variant: "destructive",
        title: "Chyba",
        description: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveHourlyRate = async () => {
    if (!canManage || !companyId || !hourlyRateEmp?.id || !firestore) return;
    const raw = hourlyRateInput.trim();
    let hourlyRateValue: number | null = null;
    if (raw !== "") {
      const parsed = Number(raw.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({ variant: "destructive", title: "Neplatná sazba." });
        return;
      }
      hourlyRateValue = parsed;
    }
    setHourlyRateSaving(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "employees", hourlyRateEmp.id), {
        hourlyRate: hourlyRateValue,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Hodinová sazba uložena" });
      setHourlyRateEmp(null);
    } catch (e) {
      console.error("[employees] hourly rate save", e);
      toast({ variant: "destructive", title: "Uložení se nezdařilo." });
    } finally {
      setHourlyRateSaving(false);
    }
  };

  const openBankDialog = (emp: Record<string, unknown> & { id?: string }) => {
    const parsed =
      parseBankAccountFromFirestore(emp.bankAccount) ?? {
        ...EMPTY_EMPLOYEE_BANK_ACCOUNT,
      };
    setBankForm({ ...parsed });
    setBankDialogEmp(emp);
  };

  const saveEmployeeBankAccount = async () => {
    if (!canEditEmployeeBank || !user || !companyId || !bankDialogEmp?.id) return;
    setBankSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/bank-account", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId: bankDialogEmp.id,
          bankAccount: bankForm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Uložení bankovních údajů selhalo."
        );
      }
      toast({
        title: "Bankovní údaje uloženy",
        description: "Údaje jsou připravené pro budoucí výplaty a exporty.",
      });
      setBankDialogEmp(null);
      setBankForm({ ...EMPTY_EMPLOYEE_BANK_ACCOUNT });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setBankSaving(false);
    }
  };

  const setAllowEmployeeBankSelfEdit = async (next: boolean) => {
    if (!canManage || !firestore || !companyId) return;
    setCompanySelfBankSaving(true);
    try {
      await updateDoc(doc(firestore, "companies", companyId), {
        allowEmployeeBankAccountSelfEdit: next,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: next ? "Zaměstnanci mohou upravovat vlastní účet" : "Vlastní účet u zaměstnanců vypnut",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Nepodařilo se uložit nastavení organizace.",
      });
    } finally {
      setCompanySelfBankSaving(false);
    }
  };

  const toggleEmployeeStatus = async (employeeId: string, currentStatus: boolean) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { isActive: !currentStatus });
      toast({
        title: "Status aktualizován",
        description: `Zaměstnanec byl ${!currentStatus ? 'aktivován' : 'deaktivován'}.`
      });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při aktualizaci" });
    }
  };

  const postTerminalPinAdmin = async (payload: {
    employeeId: string;
    action: "set" | "generate" | "clear";
    pin?: string;
  }) => {
    if (!user || !companyId) {
      throw new Error("Chybí přihlášení nebo organizace.");
    }
    const idToken = await user.getIdToken();
    const res = await fetch("/api/company/employees/terminal-pin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ...payload,
        companyId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Operace s PINem selhala."
      );
    }
    return data as {
      ok?: boolean;
      message?: string;
      generatedPin?: string;
    };
  };

  const closeTerminalPinManual = () => {
    setTerminalPinManualOpen(false);
    setTerminalPinManualEmp(null);
    setTerminalPinManualValue("");
    setTerminalPinManualConfirm("");
  };

  const submitTerminalPinManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalPinManualEmp?.id || !canManage) return;
    const err = validateTerminalPinFormat(terminalPinManualValue);
    if (err) {
      toast({ variant: "destructive", title: err });
      return;
    }
    if (terminalPinManualValue !== terminalPinManualConfirm) {
      toast({
        variant: "destructive",
        title: "PIN a potvrzení se neshodují.",
      });
      return;
    }
    setTerminalPinManualSaving(true);
    try {
      const pinNorm = normalizeTerminalPin(terminalPinManualValue);
      const data = await postTerminalPinAdmin({
        employeeId: terminalPinManualEmp.id,
        action: "set",
        pin: pinNorm,
      });
      toast({
        title: "PIN uložen",
        description:
          data.message ||
          "Zaměstnanec si při prvním použití nastaví vlastní PIN v profilu.",
      });
      closeTerminalPinManual();
    } catch (error: unknown) {
      console.error("PIN save error", error);
      const msg =
        error instanceof Error ? error.message : "Uložení PINu se nezdařilo.";
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setTerminalPinManualSaving(false);
    }
  };

  const runTerminalPinGenerate = async () => {
    if (!terminalPinGenerateEmp?.id || !canManage) return;
    setTerminalPinGenerateSaving(true);
    try {
      const data = await postTerminalPinAdmin({
        employeeId: terminalPinGenerateEmp.id,
        action: "generate",
      });
      const pin =
        typeof data.generatedPin === "string" && data.generatedPin.length > 0
          ? normalizeTerminalPin(data.generatedPin)
          : null;
      setTerminalPinGeneratedDisplay(pin);
      toast({
        title: "PIN vygenerován",
        description: pin
          ? "PIN je zobrazen níže — předejte ho zaměstnanci bezpečným kanálem."
          : data.message || "PIN byl nastaven.",
      });
    } catch (error: unknown) {
      console.error("PIN save error", error);
      const msg =
        error instanceof Error ? error.message : "Generování PINu se nezdařilo.";
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setTerminalPinGenerateSaving(false);
    }
  };

  const closeTerminalPinGenerateDialog = () => {
    setTerminalPinGenerateOpen(false);
    setTerminalPinGenerateEmp(null);
    setTerminalPinGeneratedDisplay(null);
  };

  const runTerminalPinClear = async () => {
    if (!terminalPinClearEmp?.id || !canManage) return;
    setTerminalPinClearSaving(true);
    try {
      const data = await postTerminalPinAdmin({
        employeeId: terminalPinClearEmp.id,
        action: "clear",
      });
      toast({
        title: "PIN zrušen",
        description: data.message || "Docházkový PIN byl odstraněn.",
      });
      setTerminalPinClearOpen(false);
      setTerminalPinClearEmp(null);
    } catch (error: unknown) {
      console.error("PIN save error", error);
      const msg =
        error instanceof Error ? error.message : "Zrušení PINu se nezdařilo.";
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setTerminalPinClearSaving(false);
    }
  };

  const deleteEmployee = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    if (!confirm('Opravdu chcete tohoto zaměstnance odstranit?')) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await deleteDoc(docRef);
      toast({ title: "Zaměstnanec odstraněn" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při mazání" });
    }
  };

  const openOrgSettingsForEmployee = (emp: Record<string, unknown> & { id?: string }) => {
    setOrgSettingsEmp(emp);
    setOrgSettingsRole(parseEmployeeOrgRole(emp as { role?: unknown }));
    setOrgSettingsTerminalVisible(
      isVisibleInAttendanceTerminal(emp as { visibleInAttendanceTerminal?: boolean })
    );
    setOrgSettingsCanWarehouse(
      (emp as { canAccessWarehouse?: boolean }).canAccessWarehouse === true
    );
    setOrgSettingsCanProduction(
      (emp as { canAccessProduction?: boolean }).canAccessProduction === true
    );
    const pm = parseEmployeePortalModules(emp);
    setPortalModZakazky(pm.zakazky);
    setPortalModPenize(pm.penize);
    setPortalModZpravy(pm.zpravy);
    setPortalModDochazka(pm.dochazka);
  };

  const closePwdResetDialog = () => {
    setPwdResetEmployee(null);
    setPwdResetNew("");
    setPwdResetConfirm("");
  };

  const handleAdminPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canResetEmployeeAuthPassword || !user || !pwdResetEmployee?.id) return;
    if (pwdResetNew.length < MIN_EMPLOYEE_PASSWORD_LENGTH) {
      toast({
        variant: "destructive",
        title: "Slabé heslo",
        description: `Nové heslo musí mít alespoň ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků.`,
      });
      return;
    }
    if (pwdResetNew !== pwdResetConfirm) {
      toast({
        variant: "destructive",
        title: "Hesla se neshodují",
        description: "Zkontrolujte nové heslo a potvrzení.",
      });
      return;
    }
    if (!companyId) {
      toast({
        variant: "destructive",
        title: "Chybí organizace",
        description: "Nelze nastavit heslo bez kontextu firmy.",
      });
      return;
    }
    setPwdResetLoading(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId: pwdResetEmployee.id,
          newPassword: pwdResetNew,
          companyId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Reset hesla selhal."
        );
      }
      toast({
        title: "Heslo bylo nastaveno",
        description:
          data.message ||
          "Zaměstnanec se přihlásí novým heslem; staré heslo již neplatí.",
      });
      closePwdResetDialog();
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Nepodařilo se nastavit heslo.";
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setPwdResetLoading(false);
    }
  };

  const saveOrgSettings = async () => {
    if (!canManage || !user || !orgSettingsEmp?.id || orgSettingsSaving) return;
    setOrgSettingsSaving(true);
    try {
      const idToken = await user.getIdToken();
      const employeePortalModules = {
        zakazky: portalModZakazky === true,
        penize: portalModPenize === true,
        zpravy: portalModZpravy === true,
        dochazka: portalModDochazka === true,
      };
      const payload = {
        employeeId: orgSettingsEmp.id,
        role: orgSettingsRole,
        visibleInAttendanceTerminal: orgSettingsTerminalVisible,
        canAccessWarehouse: orgSettingsCanWarehouse,
        canAccessProduction: orgSettingsCanProduction,
        employeePortalModules,
      };
      const res = await fetch("/api/company/employees/update-org", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Uložení se nezdařilo."
        );
      }
      toast({
        title: "Uloženo",
        description:
          "Role, terminál, sklad / výroba a moduly zaměstnaneckého portálu byly aktualizovány.",
      });
      setOrgSettingsEmp(null);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Uložení se nezdařilo.";
      toast({ variant: "destructive", title: "Chyba", description: msg });
    } finally {
      setOrgSettingsSaving(false);
    }
  };

  if (!canView && profile) return null;

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl break-words">
            Správa zaměstnanců
          </h1>
          <p className="portal-page-description">Pracovníci organizace {companyId}.</p>
          {canManage ? (
            <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <Label
                  htmlFor="allow-emp-bank-self"
                  className="text-sm font-medium text-foreground"
                >
                  Vlastní bankovní údaje v profilu zaměstnance
                </Label>
                <p className="text-xs text-muted-foreground">
                  Pokud zapnete, zaměstnanec si může číslo účtu vyplnit nebo změnit v sekci Profil
                  (přístup přes API, data zůstávají v záznamu zaměstnance).
                </p>
              </div>
              <Switch
                id="allow-emp-bank-self"
                checked={allowEmployeeBankAccountSelfEdit}
                disabled={companySelfBankSaving}
                onCheckedChange={(v) => void setAllowEmployeeBankSelfEdit(v)}
              />
            </div>
          ) : null}
        </div>
        <div className="flex gap-2 sm:gap-3">
          {canManage && (
            <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <UserPlus className="w-4 h-4" /> Pozvat zaměstnance
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold text-black">
                    Pozvat nového člena týmu
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-700">
                    Vytvoří se profil zaměstnance a přihlašovací účet (email + heslo). Heslo se
                    neukládá do databáze, pouze do Firebase Authentication.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4 py-4 text-black">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName" className={INVITE_LABEL_CLASS}>
                        Jméno
                      </Label>
                      <Input
                        id="firstName"
                        required
                        value={inviteData.firstName}
                        onChange={(e) =>
                          setInviteData({ ...inviteData, firstName: e.target.value })
                        }
                        className={INVITE_INPUT_CLASS}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName" className={INVITE_LABEL_CLASS}>
                        Příjmení
                      </Label>
                      <Input
                        id="lastName"
                        required
                        value={inviteData.lastName}
                        onChange={(e) =>
                          setInviteData({ ...inviteData, lastName: e.target.value })
                        }
                        className={INVITE_INPUT_CLASS}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className={INVITE_LABEL_CLASS}>
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={inviteData.email}
                      onChange={(e) =>
                        setInviteData({ ...inviteData, email: e.target.value })
                      }
                      className={INVITE_INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="jobTitle" className={INVITE_LABEL_CLASS}>
                      Pracovní pozice
                    </Label>
                    <Input
                      id="jobTitle"
                      placeholder="Např. Svářeč"
                      value={inviteData.jobTitle}
                      onChange={(e) =>
                        setInviteData({ ...inviteData, jobTitle: e.target.value })
                      }
                      className={INVITE_INPUT_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-org-role" className={INVITE_LABEL_CLASS}>
                      Role v organizaci
                    </Label>
                    <select
                      id="invite-org-role"
                      className={INVITE_SELECT_TRIGGER_CLASS}
                      value={inviteData.orgRole}
                      onChange={(e) =>
                        setInviteData({
                          ...inviteData,
                          orgRole: e.target.value === "orgAdmin" ? "orgAdmin" : "employee",
                        })
                      }
                    >
                      <option value="employee">Běžný zaměstnanec</option>
                      <option value="orgAdmin">Administrátor organizace</option>
                    </select>
                    <p className="text-[10px] text-gray-600">
                      Administrátor organizace spravuje tuto firmu v portálu (zaměstnanci, zakázky, docházka…), bez
                      přístupu ke globální správě platformy.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                    <div className="min-w-0 space-y-0.5">
                      <Label htmlFor="invite-terminal-visible" className={INVITE_LABEL_CLASS}>
                        Zobrazit v terminálu docházky
                      </Label>
                      <p className="text-[10px] text-gray-600">
                        Vypnutí skryje zaměstnance na veřejné docházce — nelze ho vybrat ani přihlásit PINem.
                      </p>
                    </div>
                    <Switch
                      id="invite-terminal-visible"
                      checked={inviteData.visibleInAttendanceTerminal}
                      onCheckedChange={(v) =>
                        setInviteData({ ...inviteData, visibleInAttendanceTerminal: v })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="invitePassword" className={INVITE_LABEL_CLASS}>
                        Heslo pro přihlášení
                      </Label>
                      <Input
                        id="invitePassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                        value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        className={INVITE_INPUT_CLASS}
                        placeholder={`Min. ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků`}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invitePasswordConfirm" className={INVITE_LABEL_CLASS}>
                        Potvrzení hesla
                      </Label>
                      <Input
                        id="invitePasswordConfirm"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={invitePasswordConfirm}
                        onChange={(e) => setInvitePasswordConfirm(e.target.value)}
                        className={INVITE_INPUT_CLASS}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hourlyRate" className={INVITE_LABEL_CLASS}>
                      Hodinová sazba (Kč/h)
                    </Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                      <Input
                        id="hourlyRate"
                        type="number"
                        placeholder="např. 350"
                        value={inviteData.hourlyRate}
                        onChange={(e) =>
                          setInviteData({ ...inviteData, hourlyRate: e.target.value })
                        }
                        className={cn(INVITE_INPUT_CLASS, "pl-10")}
                      />
                    </div>
                    <p className="text-[10px] text-gray-600">
                      Tato sazba se používá pro výpočet finančních nákladů firmy.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Vytvořit zaměstnance a účet"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Dialog
        open={!!orgSettingsEmp}
        onOpenChange={(open) => {
          if (!open) {
            setOrgSettingsEmp(null);
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-lg border border-gray-200 bg-white p-6 text-black shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Role, terminál a moduly sklad / výroba
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {orgSettingsEmp
                ? `${orgSettingsEmp.firstName} ${orgSettingsEmp.lastName}`
                : ""}{" "}
              — oprávnění v organizaci, terminál docházky a přístup ke skladu a výrobě (u běžného
              zaměstnance jen pokud je modul ve firmě zapnutý a zde povolený).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="org-settings-role" className={INVITE_LABEL_CLASS}>
                Role v organizaci
              </Label>
              <select
                id="org-settings-role"
                className={INVITE_SELECT_TRIGGER_CLASS}
                value={orgSettingsRole}
                onChange={(e) =>
                  setOrgSettingsRole(e.target.value === "orgAdmin" ? "orgAdmin" : "employee")
                }
              >
                <option value="employee">Běžný zaměstnanec</option>
                <option value="orgAdmin">Administrátor organizace</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="org-settings-terminal" className={INVITE_LABEL_CLASS}>
                  Zobrazit v terminálu docházky
                </Label>
                <p className="text-[10px] text-gray-600">
                  Vypnuto = zaměstnanec se nezobrazí v seznamu a nelze se přihlásit PINem.
                </p>
              </div>
              <Switch
                id="org-settings-terminal"
                checked={orgSettingsTerminalVisible}
                onCheckedChange={setOrgSettingsTerminalVisible}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="org-settings-warehouse" className={INVITE_LABEL_CLASS}>
                  Přístup ke skladu
                </Label>
                <p className="text-[10px] text-gray-600">
                  Běžný zaměstnanec uvidí modul Sklad jen s tímto příznakem (a zapnutým modulem u
                  licence).
                </p>
              </div>
              <Switch
                id="org-settings-warehouse"
                checked={orgSettingsCanWarehouse}
                onCheckedChange={setOrgSettingsCanWarehouse}
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="org-settings-production" className={INVITE_LABEL_CLASS}>
                  Přístup k výrobě
                </Label>
                <p className="text-[10px] text-gray-600">
                  Stejně jako sklad — jen vybraní zaměstnanci.
                </p>
              </div>
              <Switch
                id="org-settings-production"
                checked={orgSettingsCanProduction}
                onCheckedChange={setOrgSettingsCanProduction}
              />
            </div>
            <div className="space-y-2 border-t border-gray-200 pt-3">
              <p className="text-xs font-semibold text-gray-800">
                Moduly zaměstnaneckého portálu
              </p>
              <p className="text-[10px] text-gray-600">
                Viditelnost v menu závisí i na licenci firmy — vypnuto zde skryje položku, i když je
                modul ve firmě aktivní.
              </p>
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                <Label htmlFor="portal-mod-zakazky" className={INVITE_LABEL_CLASS}>
                  Povolit Zakázky
                </Label>
                <Switch
                  id="portal-mod-zakazky"
                  checked={portalModZakazky}
                  onCheckedChange={setPortalModZakazky}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                <Label htmlFor="portal-mod-penize" className={INVITE_LABEL_CLASS}>
                  Povolit Peníze
                </Label>
                <Switch
                  id="portal-mod-penize"
                  checked={portalModPenize}
                  onCheckedChange={setPortalModPenize}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                <Label htmlFor="portal-mod-zpravy" className={INVITE_LABEL_CLASS}>
                  Povolit Zprávy
                </Label>
                <Switch
                  id="portal-mod-zpravy"
                  checked={portalModZpravy}
                  onCheckedChange={setPortalModZpravy}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
                <Label htmlFor="portal-mod-dochazka" className={INVITE_LABEL_CLASS}>
                  Povolit Docházku (výkazy, práce a mzdy)
                </Label>
                <Switch
                  id="portal-mod-dochazka"
                  checked={portalModDochazka}
                  onCheckedChange={setPortalModDochazka}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200 bg-white text-black"
              onClick={() => {
                setOrgSettingsEmp(null);
                releaseModalLocksAfterDismiss();
              }}
              disabled={orgSettingsSaving}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void saveOrgSettings()}
              disabled={orgSettingsSaving || !canManage}
            >
              {orgSettingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-3 sm:p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-3 sm:gap-4 justify-between min-w-0">
          <div className="relative w-full max-w-full sm:max-w-md sm:w-80 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Hledat jméno nebo email..." className="pl-10 bg-background border-border" />
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-2 min-h-10 sm:min-h-9 touch-manipulation">
              <Filter className="w-4 h-4 shrink-0" /> Filtr
            </Button>
            <Button variant="outline" size="sm" className="gap-2 min-h-10 sm:min-h-9 touch-manipulation">
              <Download className="w-4 h-4 shrink-0" /> Exportovat
            </Button>
          </div>
        </div>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : employees && employees.length > 0 ? (
            <Table className="min-w-[880px] w-full">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Zaměstnanec</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Terminál</TableHead>
                  <TableHead>PIN docházky</TableHead>
                  <TableHead className="whitespace-nowrap">Účet (výplata)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((emp) => (
                  <TableRow key={emp.id} className="border-border hover:bg-muted/30">
                    <TableCell className="pl-6 font-medium">
                      <div className="flex flex-col">
                        <span>{emp.firstName} {emp.lastName}</span>
                        <span className="text-xs text-muted-foreground font-normal">{emp.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {parseEmployeeOrgRole(emp as { role?: unknown }) === "orgAdmin"
                          ? "Administrátor organizace"
                          : "Zaměstnanec"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isVisibleInAttendanceTerminal(
                        emp as { visibleInAttendanceTerminal?: boolean }
                      ) ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-300 text-emerald-900"
                        >
                          Ano
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Ne</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {employeeTerminalPinActive(emp as Record<string, unknown>) ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-bold uppercase">
                              <KeyRound className="w-3 h-3" /> PIN nastaven
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Bez PINu</span>
                          )}
                          {emp.terminalPinNeedsChange === true && (
                            <Badge
                              variant="outline"
                              className="text-[9px] h-5 px-1.5 border-amber-500/70 text-amber-900"
                            >
                              Změnit v profilu
                            </Badge>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {emp.hourlyRate != null && emp.hourlyRate !== ""
                            ? `${emp.hourlyRate} Kč/h`
                            : "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className="font-mono text-[11px] text-muted-foreground tabular-nums"
                        title="V seznamu je účet zobrazen maskovaně. Celé údaje jsou v dialogu Bankovní údaje (oprávnění vedení)."
                      >
                        {maskBankAccountForListDisplay(
                          parseBankAccountFromFirestore(
                            (emp as Record<string, unknown>).bankAccount
                          )
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={emp.isActive ? 'default' : 'secondary'} className="capitalize">
                        {emp.isActive ? 'Aktivní' : 'Neaktivní'}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {canManage || canResetEmployeeAuthPassword ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreVertical className="w-4 h-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            {canManage ? (
                              <>
                                <DropdownMenuLabel>Správa uživatele</DropdownMenuLabel>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    void toggleEmployeeStatus(emp.id, emp.isActive);
                                  }}
                                >
                                  <UserX className="w-4 h-4 mr-2" /> {emp.isActive ? 'Deaktivovat' : 'Aktivovat'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Identifikace</DropdownMenuLabel>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    runAfterDropdownMenuCloses(() => {
                                      setTerminalPinManualEmp(emp);
                                      setTerminalPinManualValue("");
                                      setTerminalPinManualConfirm("");
                                      setTerminalPinManualOpen(true);
                                    });
                                  }}
                                >
                                  <KeyRound className="w-4 h-4 mr-2" /> Nastavit PIN ručně
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    runAfterDropdownMenuCloses(() => {
                                      setTerminalPinGenerateEmp(emp);
                                      setTerminalPinGenerateOpen(true);
                                    });
                                  }}
                                >
                                  <RefreshCw className="w-4 h-4 mr-2" />{" "}
                                  {employeeTerminalPinActive(emp as Record<string, unknown>)
                                    ? "Resetovat / vygenerovat PIN"
                                    : "Vygenerovat PIN"}
                                </DropdownMenuItem>
                                {employeeTerminalPinActive(emp as Record<string, unknown>) && (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      runAfterDropdownMenuCloses(() => {
                                        setTerminalPinClearEmp(emp);
                                        setTerminalPinClearOpen(true);
                                      });
                                    }}
                                    className="text-rose-600 focus:text-rose-600"
                                  >
                                    <Shield className="w-4 h-4 mr-2" /> Zrušit PIN
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                              </>
                            ) : null}
                            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">
                              Přihlášení
                            </DropdownMenuLabel>
                            {emp.authUserId ? (
                              <DropdownMenuItem
                                onSelect={() => {
                                  runAfterDropdownMenuCloses(() => {
                                    setPwdResetEmployee(emp);
                                    setPwdResetNew("");
                                    setPwdResetConfirm("");
                                  });
                                }}
                              >
                                <KeyRound className="w-4 h-4 mr-2" /> Nastavit nové heslo
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled className="opacity-60">
                                <KeyRound className="w-4 h-4 mr-2" /> Bez přihlašovacího účtu
                              </DropdownMenuItem>
                            )}
                            {canEditEmployeeBank && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">
                                  Peníze
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    router.push(
                                      `/portal/labor/vyplaty?employee=${encodeURIComponent(emp.id)}`
                                    );
                                  }}
                                >
                                  <DollarSign className="w-4 h-4 mr-2" /> Výplaty
                                  a výkazy
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    runAfterDropdownMenuCloses(() => {
                                      openBankDialog(
                                        emp as Record<string, unknown> & { id?: string }
                                      );
                                    });
                                  }}
                                >
                                  <Landmark className="w-4 h-4 mr-2" /> Bankovní údaje
                                  (výplata)
                                </DropdownMenuItem>
                                {canManage && (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      runAfterDropdownMenuCloses(() => {
                                        setHourlyRateEmp(emp);
                                        setHourlyRateInput(
                                          emp.hourlyRate != null && emp.hourlyRate !== ""
                                            ? String(emp.hourlyRate)
                                            : ""
                                        );
                                      });
                                    }}
                                  >
                                    <Edit2 className="w-4 h-4 mr-2" /> Hodinová sazba
                                  </DropdownMenuItem>
                                )}
                                {canManage && (
                                  <>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        runAfterDropdownMenuCloses(() =>
                                          setAssignWorklogEmployee(emp)
                                        );
                                      }}
                                    >
                                      <Briefcase className="w-4 h-4 mr-2" /> Zakázky
                                      pro výkaz práce
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        runAfterDropdownMenuCloses(() =>
                                          setAssignTerminalEmployee(emp)
                                        );
                                      }}
                                    >
                                      <Briefcase className="w-4 h-4 mr-2" /> Zakázky
                                      pro veřejné přihlášení docházky
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </>
                            )}
                            {canManage ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onSelect={() => {
                                    runAfterDropdownMenuCloses(() =>
                                      openOrgSettingsForEmployee(
                                        emp as Record<string, unknown> & { id?: string }
                                      )
                                    );
                                  }}
                                >
                                  <Edit2 className="w-4 h-4 mr-2" /> Role, terminál a portál
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() => {
                                    void deleteEmployee(emp.id);
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Odstranit
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Shield className="w-4 h-4 text-muted-foreground mx-auto opacity-20" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20">
              <p className="text-muted-foreground">Zatím nemáte žádné zaměstnance.</p>
              {canManage && (
                <Button variant="link" className="text-primary mt-2" onClick={() => setIsInviteOpen(true)}>
                  Přidat prvního pracovníka
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!hourlyRateEmp}
        onOpenChange={(open) => {
          if (!open) {
            setHourlyRateEmp(null);
            setHourlyRateInput("");
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-md border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">Hodinová sazba</DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {hourlyRateEmp
                ? `${hourlyRateEmp.firstName} ${hourlyRateEmp.lastName} — výchozí Kč za hodinu (zakázka bez vlastní sazby, obecná práce).`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="hourly-rate-edit" className={INVITE_LABEL_CLASS}>
              Kč / hod
            </Label>
            <Input
              id="hourly-rate-edit"
              className={INVITE_INPUT_CLASS}
              inputMode="decimal"
              value={hourlyRateInput}
              onChange={(e) => setHourlyRateInput(e.target.value)}
              placeholder="např. 250"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHourlyRateEmp(null);
                setHourlyRateInput("");
              }}
            >
              Zrušit
            </Button>
            <Button type="button" disabled={hourlyRateSaving} onClick={() => void saveHourlyRate()}>
              {hourlyRateSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!bankDialogEmp}
        onOpenChange={(open) => {
          if (!open) {
            setBankDialogEmp(null);
            setBankForm({ ...EMPTY_EMPLOYEE_BANK_ACCOUNT });
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Bankovní údaje (výplata)
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {bankDialogEmp
                ? `${String(bankDialogEmp.firstName ?? "")} ${String(bankDialogEmp.lastName ?? "")} — údaje pro budoucí schvalování výplat a exporty pro banku.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-gray-600 rounded-md bg-gray-50 border border-gray-200 p-2">
              Český účet: číslo ve tvaru <strong>123456789</strong> nebo{" "}
              <strong>19-123456789</strong>, kód banky <strong>4 číslice</strong>. Lze zadat i
              najednou <strong>123456789/0800</strong> do pole čísla účtu (kód banky pak nechte
              prázdný). Nebo vyplňte <strong>IBAN</strong> (ověří se kontrolní součet).
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bank-acc-num" className={INVITE_LABEL_CLASS}>
                  Číslo účtu (CZ) / předčíslí-číslo
                </Label>
                <Input
                  id="bank-acc-num"
                  className={INVITE_INPUT_CLASS}
                  autoComplete="off"
                  value={bankForm.accountNumber}
                  onChange={(e) =>
                    setBankForm((f) => ({ ...f, accountNumber: e.target.value }))
                  }
                  placeholder="např. 123456789/0800 nebo 19-123456789"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-code" className={INVITE_LABEL_CLASS}>
                  Kód banky
                </Label>
                <Input
                  id="bank-code"
                  className={INVITE_INPUT_CLASS}
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={bankForm.bankCode}
                  onChange={(e) =>
                    setBankForm((f) => ({ ...f, bankCode: e.target.value }))
                  }
                  placeholder="0800"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bank-iban" className={INVITE_LABEL_CLASS}>
                  IBAN (volitelné)
                </Label>
                <Input
                  id="bank-iban"
                  className={INVITE_INPUT_CLASS}
                  autoComplete="off"
                  value={bankForm.iban}
                  onChange={(e) =>
                    setBankForm((f) => ({
                      ...f,
                      iban: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="CZ65…"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bank-bic" className={INVITE_LABEL_CLASS}>
                  BIC / SWIFT (volitelné)
                </Label>
                <Input
                  id="bank-bic"
                  className={INVITE_INPUT_CLASS}
                  autoComplete="off"
                  value={bankForm.bic}
                  onChange={(e) =>
                    setBankForm((f) => ({
                      ...f,
                      bic: e.target.value.toUpperCase(),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="bank-note" className={INVITE_LABEL_CLASS}>
                  Poznámka k výplatě (volitelné)
                </Label>
                <Textarea
                  id="bank-note"
                  className="min-h-[72px] border-gray-200 bg-white text-black"
                  value={bankForm.paymentNote}
                  onChange={(e) =>
                    setBankForm((f) => ({ ...f, paymentNote: e.target.value }))
                  }
                  placeholder="Variabilní symbol, interní poznámka…"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200"
              disabled={bankSaving}
              onClick={() => {
                setBankForm({ ...EMPTY_EMPLOYEE_BANK_ACCOUNT });
              }}
            >
              Vymazat formulář
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBankDialogEmp(null);
                  setBankForm({ ...EMPTY_EMPLOYEE_BANK_ACCOUNT });
                }}
                disabled={bankSaving}
              >
                Zrušit
              </Button>
              <Button
                type="button"
                disabled={bankSaving || !canEditEmployeeBank}
                onClick={() => void saveEmployeeBankAccount()}
              >
                {bankSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Uložit"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pwdResetEmployee}
        onOpenChange={(open) => {
          if (!open) {
            closePwdResetDialog();
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-md border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Nastavit nové heslo
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {pwdResetEmployee
                ? `${pwdResetEmployee.firstName} ${pwdResetEmployee.lastName} — ${pwdResetEmployee.email}`
                : ""}
              <span className="block mt-2">
                Staré heslo přestane platit. Heslo se ukládá jen do Firebase Authentication.
              </span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdminPasswordReset} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="adminPwdNew" className={INVITE_LABEL_CLASS}>
                Nové heslo
              </Label>
              <Input
                id="adminPwdNew"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                value={pwdResetNew}
                onChange={(e) => setPwdResetNew(e.target.value)}
                className={INVITE_INPUT_CLASS}
                placeholder={`Min. ${MIN_EMPLOYEE_PASSWORD_LENGTH} znaků`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminPwdConfirm" className={INVITE_LABEL_CLASS}>
                Potvrzení hesla
              </Label>
              <Input
                id="adminPwdConfirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                value={pwdResetConfirm}
                onChange={(e) => setPwdResetConfirm(e.target.value)}
                className={INVITE_INPUT_CLASS}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="border-gray-200 bg-white text-black hover:bg-gray-50"
                onClick={closePwdResetDialog}
                disabled={pwdResetLoading}
              >
                Zrušit
              </Button>
              <Button type="submit" disabled={pwdResetLoading}>
                {pwdResetLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Uložit nové heslo"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={terminalPinManualOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeTerminalPinManual();
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-md border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Nastavit PIN docházky
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {terminalPinManualEmp
                ? `${terminalPinManualEmp.firstName} ${terminalPinManualEmp.lastName}`
                : ""}
              <span className="block mt-2">
                PIN se ukládá pouze jako bezpečný hash. Zaměstnanec si při prvním použití nastaví vlastní PIN v
                profilu (4–12 číslic).
              </span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitTerminalPinManual} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="terminalPinManual" className={INVITE_LABEL_CLASS}>
                Nový PIN
              </Label>
              <Input
                id="terminalPinManual"
                inputMode="numeric"
                autoComplete="off"
                value={terminalPinManualValue}
                onChange={(e) => setTerminalPinManualValue(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className={INVITE_INPUT_CLASS}
                placeholder="4–12 číslic"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="terminalPinManualConfirm" className={INVITE_LABEL_CLASS}>
                Potvrzení PINu
              </Label>
              <Input
                id="terminalPinManualConfirm"
                inputMode="numeric"
                autoComplete="off"
                value={terminalPinManualConfirm}
                onChange={(e) => setTerminalPinManualConfirm(e.target.value.replace(/\D/g, "").slice(0, 12))}
                className={INVITE_INPUT_CLASS}
                placeholder="Zopakujte PIN"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="border-gray-200 bg-white text-black hover:bg-gray-50"
                onClick={closeTerminalPinManual}
                disabled={terminalPinManualSaving}
              >
                Zrušit
              </Button>
              <Button type="submit" disabled={terminalPinManualSaving}>
                {terminalPinManualSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Uložit PIN"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={terminalPinGenerateOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeTerminalPinGenerateDialog();
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-md border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              {terminalPinGeneratedDisplay ? "Nový PIN docházky" : "Vygenerovat nový PIN"}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {terminalPinGenerateEmp
                ? `${terminalPinGenerateEmp.firstName} ${terminalPinGenerateEmp.lastName}`
                : ""}
              {!terminalPinGeneratedDisplay ? (
                <span className="block mt-2">
                  Starý PIN přestane platit. Nový kód se zobrazí níže — předejte ho zaměstnanci bezpečným kanálem.
                </span>
              ) : (
                <span className="block mt-2">
                  Toto je jediné zobrazení kódu v aplikaci. Po zavření okna už PIN nelze znovu vypsat.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {terminalPinGeneratedDisplay ? (
            <div className="py-4 space-y-4">
              <p className="text-center text-xs font-medium text-gray-600 uppercase tracking-wide">
                Nový PIN (číslice)
              </p>
              <p className="text-center text-4xl font-mono font-bold tracking-[0.2em] text-black select-all break-all">
                {terminalPinGeneratedDisplay}
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={() => closeTerminalPinGenerateDialog()}
              >
                Hotovo
              </Button>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:gap-0 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="border-gray-200 bg-white text-black hover:bg-gray-50"
                onClick={() => closeTerminalPinGenerateDialog()}
                disabled={terminalPinGenerateSaving}
              >
                Zrušit
              </Button>
              <Button
                type="button"
                onClick={() => void runTerminalPinGenerate()}
                disabled={terminalPinGenerateSaving}
              >
                {terminalPinGenerateSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Vygenerovat"
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={terminalPinClearOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTerminalPinClearOpen(false);
            setTerminalPinClearEmp(null);
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-md border border-gray-200 bg-white p-6 text-black shadow-lg [&>button.absolute]:text-gray-600 [&>button.absolute]:hover:bg-gray-100 [&>button.absolute]:hover:text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">Zrušit PIN docházky</DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {terminalPinClearEmp
                ? `${terminalPinClearEmp.firstName} ${terminalPinClearEmp.lastName}`
                : ""}
              <span className="block mt-2">
                Zaměstnanec se již nebude moci přihlásit PINem na veřejné docházce, dokud administrátor PIN znovu
                nenastaví.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200 bg-white text-black hover:bg-gray-50"
              onClick={() => {
                setTerminalPinClearOpen(false);
                setTerminalPinClearEmp(null);
              }}
              disabled={terminalPinClearSaving}
            >
              Zpět
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void runTerminalPinClear()}
              disabled={terminalPinClearSaving}
            >
              {terminalPinClearSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Zrušit PIN"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!assignWorklogEmployee}
        onOpenChange={(open) => {
          if (!open) {
            setAssignWorklogEmployee(null);
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-lg border border-gray-200 bg-white p-6 text-black shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Zakázky pro výkaz práce
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {assignWorklogEmployee
                ? `${assignWorklogEmployee.firstName} ${assignWorklogEmployee.lastName}`
                : ""}{" "}
              uvidí při zápisu výkazu jen tyto zakázky (odděleně od terminálu docházky).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 rounded-md border border-gray-200 bg-gray-50/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="toggle-unified-work-report" className="text-sm font-medium text-black">
                  Výkaz práce
                </Label>
                <p className="text-xs text-gray-600">
                  Zapne denní výkaz vázaný na terminál a docházku (sekce Výkaz práce v portálu). Vypnutím skryjete
                  výkazování u tohoto zaměstnance.
                </p>
              </div>
              <Switch
                id="toggle-unified-work-report"
                checked={enableUnifiedWorkReportToggle}
                onCheckedChange={setEnableUnifiedWorkReportToggle}
                disabled={!canManage}
              />
            </div>
          </div>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-2">
            {companyJobsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : companyJobs.length === 0 ? (
              <p className="text-sm text-gray-600">
                Ve firmě zatím nejsou žádné zakázky. Vytvořte je v sekci Zakázky.
              </p>
            ) : (
              companyJobs.map((job) => (
                <label
                  key={job.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 text-sm hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={assignWorklogJobIds.has(job.id)}
                    onChange={() => toggleAssignWorklogJob(job.id)}
                  />
                  <span className="font-medium text-black">
                    {job.name?.trim() || job.id}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200 bg-white text-black"
              onClick={() => {
                setAssignWorklogEmployee(null);
                releaseModalLocksAfterDismiss();
              }}
              disabled={savingAssignedWorklogJobs}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void saveAssignedWorklogJobs()}
              disabled={savingAssignedWorklogJobs || !canManage}
            >
              {savingAssignedWorklogJobs ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Uložit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!assignTerminalEmployee}
        onOpenChange={(open) => {
          if (!open) {
            setAssignTerminalEmployee(null);
            releaseModalLocksAfterDismiss();
          }
        }}
      >
        <DialogContent className="max-w-lg border border-gray-200 bg-white p-6 text-black shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-black">
              Zakázky pro veřejné přihlášení docházky
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {assignTerminalEmployee
                ? `${assignTerminalEmployee.firstName} ${assignTerminalEmployee.lastName}`
                : ""}{" "}
              uvidí při příchodu na veřejné docházce jen tyto zakázky (odděleně od výkazu práce).
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 text-sm hover:bg-gray-50">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0"
              checked={autoApproveJobEarningsTerminal}
              onChange={(e) => setAutoApproveJobEarningsTerminal(e.target.checked)}
            />
            <span>
              <span className="font-medium text-black">
                Automatické schvalování výdělku při práci na zakázce
              </span>
              <span className="mt-1 block text-xs text-gray-600">
                Po uzavření úseku na zakázce z tohoto terminálu se výdělek schválí bez ručního výkazu a bez
                schválení vedením. Platí jen pro zakázku zvolenou na terminálu, ne pro tarify.
              </span>
            </span>
          </label>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-2">
            {companyJobsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : companyJobs.length === 0 ? (
              <p className="text-sm text-gray-600">
                Ve firmě zatím nejsou žádné zakázky. Vytvořte je v sekci Zakázky.
              </p>
            ) : (
              companyJobs.map((job) => (
                <label
                  key={job.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 text-sm hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={assignTerminalJobIds.has(job.id)}
                    onChange={() => toggleAssignTerminalJob(job.id)}
                  />
                  <span className="font-medium text-black">
                    {job.name?.trim() || job.id}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border-gray-200 bg-white text-black"
              onClick={() => {
                setAssignTerminalEmployee(null);
                releaseModalLocksAfterDismiss();
              }}
              disabled={savingAssignedTerminalJobs}
            >
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => void saveAssignedTerminalJobs()}
              disabled={savingAssignedTerminalJobs || !canManage}
            >
              {savingAssignedTerminalJobs ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Uložit"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}