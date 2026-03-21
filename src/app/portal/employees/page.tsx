"use client";
import { Separator } from "@/components/ui/separator";

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
  QrCode,
  Eye,
  DownloadCloud,
  Briefcase,
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
import { cn } from "@/lib/utils";

/** Světlý styl polí v modálu „Pozvat člena týmu“ (neovlivní zbytek portálu). */
const INVITE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base text-black ring-offset-0 placeholder:text-gray-400 focus-visible:border-orange-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:ring-offset-0 md:text-sm disabled:opacity-70";

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
import { releaseDocumentModalLocks } from "@/lib/release-modal-locks";

function releaseModalLocksAfterDismiss() {
  releaseDocumentModalLocks();
  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => releaseDocumentModalLocks());
  }
}

export default function EmployeesPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const router = useRouter();

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
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
    ["owner", "admin", "manager"].includes(userRole) || isSuperAdmin;

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, 'companies', companyId, 'employees');
  }, [firestore, companyId]);

  const { data: employees, isLoading } = useCollection(employeesQuery);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteData, setInviteData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'employee',
    jobTitle: '',
    hourlyRate: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
  }, [profile, canView, userRole, router, toast]);

  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState("");

  const [pwdResetEmployee, setPwdResetEmployee] = useState<any | null>(null);
  const [pwdResetNew, setPwdResetNew] = useState("");
  const [pwdResetConfirm, setPwdResetConfirm] = useState("");
  const [pwdResetLoading, setPwdResetLoading] = useState(false);

  const [assignWorklogEmployee, setAssignWorklogEmployee] = useState<any | null>(
    null
  );
  const [assignWorklogJobIds, setAssignWorklogJobIds] = useState<Set<string>>(
    new Set()
  );
  const [savingAssignedWorklogJobs, setSavingAssignedWorklogJobs] =
    useState(false);

  const [assignTerminalEmployee, setAssignTerminalEmployee] = useState<any | null>(
    null
  );
  const [assignTerminalJobIds, setAssignTerminalJobIds] = useState<Set<string>>(
    new Set()
  );
  const [savingAssignedTerminalJobs, setSavingAssignedTerminalJobs] =
    useState(false);

  const jobsForAssignQuery = useMemoFirebase(
    () =>
      firestore && companyId && (assignWorklogEmployee || assignTerminalEmployee)
        ? collection(firestore, "companies", companyId, "jobs")
        : null,
    [firestore, companyId, assignWorklogEmployee, assignTerminalEmployee]
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

  useEffect(() => {
    if (!assignWorklogEmployee) {
      setAssignWorklogJobIds(new Set());
      return;
    }
    setAssignWorklogJobIds(
      new Set(parseAssignedWorklogJobIds(assignWorklogEmployee))
    );
  }, [assignWorklogEmployee]);

  useEffect(() => {
    if (!assignTerminalEmployee) {
      setAssignTerminalJobIds(new Set());
      return;
    }
    setAssignTerminalJobIds(
      new Set(parseAssignedTerminalJobIds(assignTerminalEmployee))
    );
  }, [assignTerminalEmployee]);

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
      releaseModalLocksAfterDismiss();
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
          updatedAt: serverTimestamp(),
        }
      );
      toast({
        title: "Uloženo",
        description: "Zakázky pro docházkový terminál byly aktualizovány.",
      });
      setAssignTerminalEmployee(null);
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingAssignedTerminalJobs(false);
      releaseModalLocksAfterDismiss();
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
        role: "employee",
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

  const generatePin = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    const newPin = Math.floor(1000 + Math.random() * 9000).toString();
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendancePin: newPin });
      toast({ title: "PIN vygenerován", description: `Nový docházkový PIN pro zaměstnance: ${newPin}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const generateQrId = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    const newQrId = `QR-${Math.random().toString(36).substring(2, 15)}`;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendanceQrId: newQrId });
      toast({ title: "QR ID vygenerováno", description: "Nový identifikátor pro QR docházku byl vytvořen." });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
    }
  };

  const disablePin = async (employeeId: string) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { attendancePin: null });
      toast({ title: "PIN deaktivován" });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba" });
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

  const changeRole = async (employeeId: string, newRole: string) => {
    if (!canManage || !companyId) return;
    try {
      const docRef = doc(firestore, 'companies', companyId, 'employees', employeeId);
      await updateDoc(docRef, { role: newRole });
      toast({ title: "Role změněna", description: `Nová role: ${newRole}` });
    } catch (error) {
      toast({ variant: "destructive", title: "Chyba při změně role" });
    }
  };

  if (!canView && profile) return null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Správa zaměstnanců</h1>
          <p className="portal-page-description">Pracovníci organizace {companyId}.</p>
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
                    <p className="text-[10px] text-gray-500">
                      Účet v aplikaci má roli <strong>zaměstnanec</strong> (vlastní portál, bez přístupu k administraci firmy).
                    </p>
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
                      <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
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
                    <p className="text-[10px] text-gray-500">
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

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Hledat jméno nebo email..." className="pl-10 bg-background border-border" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" /> Filtr
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="w-4 h-4" /> Exportovat
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : employees && employees.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Zaměstnanec</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Identifikace (PIN/QR)</TableHead>
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
                    <TableCell className="capitalize">
                      <Badge variant="outline" className="border-primary/30 text-primary">
                        {emp.role === 'owner' ? 'Majitel' : 
                         emp.role === 'admin' ? 'Administrátor' : 
                         emp.role === 'manager' ? 'Manažer' : 
                         emp.role === 'accountant' ? 'Účetní' : 'Zaměstnanec'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {emp.attendancePin ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold uppercase">
                              <KeyRound className="w-3 h-3" /> {emp.attendancePin}
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Bez PINu</span>
                          )}
                          <Separator orientation="vertical" className="h-3 mx-1" />
                          {emp.attendanceQrId ? (
                            <Button 
                              variant="ghost" 
                              className="h-auto p-0 text-[10px] text-primary font-bold uppercase gap-1"
                              onClick={() => setQrEmployee(emp)}
                            >
                              <QrCode className="w-3 h-3" /> QR aktivní
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Bez QR</span>
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
                                <DropdownMenuItem onClick={() => toggleEmployeeStatus(emp.id, emp.isActive)}>
                                  <UserX className="w-4 h-4 mr-2" /> {emp.isActive ? 'Deaktivovat' : 'Aktivovat'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Identifikace</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => generatePin(emp.id)}>
                                  <RefreshCw className="w-4 h-4 mr-2" /> {emp.attendancePin ? 'Resetovat PIN' : 'Generovat PIN'}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  if (!emp.attendanceQrId) generateQrId(emp.id);
                                  setQrEmployee(emp);
                                }}>
                                  <QrCode className="w-4 h-4 mr-2" /> {emp.attendanceQrId ? 'Zobrazit QR kód' : 'Generovat QR kód'}
                                </DropdownMenuItem>
                                {emp.attendancePin && (
                                  <DropdownMenuItem onClick={() => disablePin(emp.id)} className="text-rose-500">
                                    <Shield className="w-4 h-4 mr-2" /> Zakázat PIN
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
                                onClick={() => {
                                  setPwdResetEmployee(emp);
                                  setPwdResetNew("");
                                  setPwdResetConfirm("");
                                }}
                              >
                                <KeyRound className="w-4 h-4 mr-2" /> Nastavit nové heslo
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled className="opacity-60">
                                <KeyRound className="w-4 h-4 mr-2" /> Bez přihlašovacího účtu
                              </DropdownMenuItem>
                            )}
                            {(canManage ||
                              ["owner", "admin", "manager", "accountant"].includes(
                                userRole
                              ) ||
                              isSuperAdmin) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">
                                  Peníze
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() =>
                                    router.push(
                                      `/portal/employees/payroll?employee=${encodeURIComponent(emp.id)}`
                                    )
                                  }
                                >
                                  <DollarSign className="w-4 h-4 mr-2" /> Výplaty
                                  a výkazy
                                </DropdownMenuItem>
                                {canManage && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => setAssignWorklogEmployee(emp)}
                                    >
                                      <Briefcase className="w-4 h-4 mr-2" /> Zakázky
                                      pro výkaz práce
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => setAssignTerminalEmployee(emp)}
                                    >
                                      <Briefcase className="w-4 h-4 mr-2" /> Zakázky
                                      pro docházkový terminál
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </>
                            )}
                            {canManage ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase">Změnit roli</DropdownMenuLabel>
                                <DropdownMenuItem onClick={() => changeRole(emp.id, 'admin')}>Administrátor</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => changeRole(emp.id, 'manager')}>Manažer</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => changeRole(emp.id, 'employee')}>Zaměstnanec</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => deleteEmployee(emp.id)}>
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
        open={!!pwdResetEmployee}
        onOpenChange={(open) => {
          if (!open) closePwdResetDialog();
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
              Zakázky pro docházkový terminál
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-700">
              {assignTerminalEmployee
                ? `${assignTerminalEmployee.firstName} ${assignTerminalEmployee.lastName}`
                : ""}{" "}
              uvidí při příchodu na terminálu jen tyto zakázky (odděleně od výkazu práce).
            </DialogDescription>
          </DialogHeader>
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

      {/* QR Code Dialog */}
      <Dialog open={!!qrEmployee} onOpenChange={() => setQrEmployee(null)}>
        <DialogContent className="bg-surface border-border max-w-xs sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Docházkový QR kód</DialogTitle>
            <DialogDescription>
              Zaměstnanec: {qrEmployee?.firstName} {qrEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center p-6 bg-white rounded-xl space-y-4">
            {qrEmployee?.attendanceQrId && (
              <QRCodeSVG 
                value={qrEmployee.attendanceQrId} 
                size={200}
                level="H"
                includeMargin={true}
              />
            )}
            <p className="text-black font-mono text-[10px] select-all">{qrEmployee?.attendanceQrId}</p>
          </div>
          <DialogFooter className="sm:justify-center">
            <Button className="w-full gap-2" onClick={() => window.print()}>
              <DownloadCloud className="w-4 h-4" /> Vytisknout kartu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}