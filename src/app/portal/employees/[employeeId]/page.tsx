"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { EmployeePortalRolePermissionsEditor } from "@/components/employees/employee-portal-role-permissions-editor";
import { EmployeeEffectiveAccessPanel } from "@/components/employees/employee-effective-access-panel";
import {
  calendarLevelsForAdminEditor,
  defaultCalendarLevelsForNewEmployee,
  portalPermissionLevelsForAdminEditor,
} from "@/lib/portal-permissions-admin";
import {
  EmployeeCameraPermissionsBlock,
  parseEmployeeCameraFlagsFromDoc,
} from "@/components/employees/employee-camera-permissions-block";
import { canStartPortalPreviewAsAdmin } from "@/lib/portal-preview";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  parseEmployeePortalRole,
  type EmployeePortalRoleId,
} from "@/lib/employee-portal-role";
import {
  ALL_PORTAL_MODULE_IDS,
  canAccessPortalModule,
  canManagePortalPermissions,
  employeeHasExplicitPortalModuleMatrix,
  type PortalAccessLevel,
  type PortalModuleId,
  parseDashboardAiAssistantEnabled,
} from "@/lib/portal-permissions";
import { usePortalPermissionsOptional } from "@/contexts/portal-permissions-context";
import { normalizeCompanyRole } from "@/lib/company-privilege";
import {
  aggregateScheduleModuleLevel,
  normalizeCalendarPermissionsForFirestore,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";
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
import {
  UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS,
  normalizeUnreadPhotoNoteIntervalHours,
  unreadPhotoNoteIntervalLabelCs,
  type UnreadPhotoNoteIntervalHours,
} from "@/lib/job-photo-comment-email-settings";
import { EmployeeDocumentsSection } from "@/components/portal/EmployeeDocumentsSection";
import { EmployeeGenerateDocumentDialog } from "@/components/portal/EmployeeGenerateDocumentDialog";
import {
  JOB_ROLE_ON_SITE_OPTIONS,
  memberPermissionsForAccessMode,
  type JobAccessMode,
  type JobRoleOnSite,
} from "@/lib/job-employee-access";
import { useIsBelowLg } from "@/hooks/use-mobile";
import {
  Loader2,
  ArrowLeft,
  Save,
  Upload,
  UserX,
  Clock,
  DollarSign,
  Wallet,
  Eye,
} from "lucide-react";

function employeeDisplayName(e: Record<string, unknown> | null | undefined): string {
  if (!e) return "Zaměstnanec";
  const first = String(e.firstName ?? "").trim();
  const last = String(e.lastName ?? "").trim();
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || String(e.email ?? "").trim() || "Zaměstnanec";
}

type EmployeeCameraFlags = ReturnType<typeof parseEmployeeCameraFlagsFromDoc>;

function orgPermissionsPayloadJson(params: {
  portalRole: EmployeePortalRoleId;
  moduleLevels: Record<PortalModuleId, PortalAccessLevel>;
  calendarLevels: Record<CalendarSubPermissionKey, PortalAccessLevel>;
  visibleInTerminal: boolean;
  dashboardAiAssistantEnabled: boolean;
  cameraFlags: EmployeeCameraFlags;
}): string {
  const schedule = aggregateScheduleModuleLevel(params.calendarLevels);
  const portalModulePermissions: Record<string, string> = {};
  for (const id of ALL_PORTAL_MODULE_IDS) {
    portalModulePermissions[id] =
      id === "schedule" ? schedule : params.moduleLevels[id] ?? "none";
  }
  return JSON.stringify({
    role: params.portalRole,
    visibleInAttendanceTerminal: params.visibleInTerminal,
    portalModulePermissions,
    calendarPermissions: normalizeCalendarPermissionsForFirestore(params.calendarLevels),
    cameraPermissions: params.cameraFlags,
    dashboardAiAssistantEnabled: params.dashboardAiAssistantEnabled,
  });
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
  const searchParams = useSearchParams();
  const params = useParams<{ employeeId: string }>();
  const employeeId = String(params?.employeeId ?? "").trim();

  const { user, isUserLoading } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyName, company } = useCompany();
  const belowLg = useIsBelowLg();

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

  const portalPermsCtx = usePortalPermissionsOptional();

  const canManage = useMemo(() => {
    const role = normalizeCompanyRole(String(profile?.role ?? ""));
    if (role === "owner" || role === "admin") return true;
    const globalRoles = profile?.globalRoles as string[] | undefined;
    if (Array.isArray(globalRoles) && globalRoles.includes("super_admin")) return true;
    const perms = portalPermsCtx?.permissions;
    if (perms) {
      return canAccessPortalModule(perms, "employees", "write");
    }
    return false;
  }, [profile?.role, profile?.globalRoles, portalPermsCtx?.permissions]);

  const canManageOrgRoles = useMemo(() => {
    return canManagePortalPermissions(
      String(profile?.role ?? ""),
      profile?.globalRoles as string[] | undefined
    );
  }, [profile?.role, profile?.globalRoles]);

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

  useEffect(() => {
    const t = searchParams.get("tab");
    if (
      t === "overview" ||
      t === "personal" ||
      t === "work" ||
      t === "terminal" ||
      t === "roles" ||
      t === "jobs" ||
      t === "documents" ||
      t === "contracts" ||
      t === "photos" ||
      t === "signatures"
    ) {
      setTab(t);
    }
  }, [searchParams]);

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

  const [savingPersonal, setSavingPersonal] = useState(false);
  const [portalNotifLoading, setPortalNotifLoading] = useState(false);
  const [portalNotifSaving, setPortalNotifSaving] = useState(false);
  const [portalNotifForm, setPortalNotifForm] = useState<{
    linked: boolean;
    emailMessageNotificationsEnabled: boolean;
    emailUnreadPhotoNoteNotificationsEnabled: boolean;
    unreadNoteNotificationIntervalHours: UnreadPhotoNoteIntervalHours;
  } | null>(null);

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

  useEffect(() => {
    if (!canManage || !user || !employeeId) return;
    let cancelled = false;
    setPortalNotifLoading(true);
    void (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/company/employees/portal-notification-settings?employeeId=${encodeURIComponent(employeeId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (cancelled) return;
        if (!res.ok) {
          setPortalNotifForm(null);
          return;
        }
        setPortalNotifForm({
          linked: data.linked === true,
          emailMessageNotificationsEnabled: data.emailMessageNotificationsEnabled !== false,
          emailUnreadPhotoNoteNotificationsEnabled:
            data.emailUnreadPhotoNoteNotificationsEnabled !== false,
          unreadNoteNotificationIntervalHours: normalizeUnreadPhotoNoteIntervalHours(
            data.unreadNoteNotificationIntervalHours
          ),
        });
      } catch {
        if (!cancelled) setPortalNotifForm(null);
      } finally {
        if (!cancelled) setPortalNotifLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, user, employeeId]);

  const savePortalNotifications = async () => {
    if (!canManage || !user || !employeeId || portalNotifSaving || !portalNotifForm) return;
    setPortalNotifSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/portal-notification-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId,
          emailMessageNotificationsEnabled: portalNotifForm.emailMessageNotificationsEnabled,
          emailUnreadPhotoNoteNotificationsEnabled:
            portalNotifForm.emailUnreadPhotoNoteNotificationsEnabled,
          unreadNoteNotificationIntervalHours: portalNotifForm.unreadNoteNotificationIntervalHours,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Uložení selhalo.");
      }
      toast({ title: "Uloženo", description: "Nastavení e-mailů portálu bylo aktualizováno." });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPortalNotifSaving(false);
    }
  };
  const savePersonal = async () => {
    if (!canManage || !user || !employeeId || savingPersonal) return;
    setSavingPersonal(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/employees/update-person", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          employeeId,
          firstName: personalForm.firstName.trim(),
          lastName: personalForm.lastName.trim(),
          email: personalForm.email.trim(),
          phone: personalForm.phone.trim(),
          address: personalForm.address.trim(),
          jobTitle: personalForm.jobTitle.trim(),
          note: personalForm.note.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Uložení selhalo.");
      }
      toast({ title: "Uloženo", description: "Osobní údaje byly aktualizovány." });
    } catch (e: unknown) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení selhalo",
        description: e instanceof Error ? e.message : undefined,
      });
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
  const [portalRole, setPortalRole] = useState<EmployeePortalRoleId>("employee");
  const [moduleLevels, setModuleLevels] = useState<Record<PortalModuleId, PortalAccessLevel>>(() =>
    portalPermissionLevelsForAdminEditor(null, "employee")
  );
  const [calendarLevels, setCalendarLevels] = useState<
    Record<CalendarSubPermissionKey, PortalAccessLevel>
  >(() => defaultCalendarLevelsForNewEmployee());
  const [visibleInTerminal, setVisibleInTerminal] = useState(true);
  const [dashboardAiAssistantEnabled, setDashboardAiAssistantEnabled] = useState(true);
  const [cameraFlags, setCameraFlags] = useState(parseEmployeeCameraFlagsFromDoc(null));
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewStarting, setPreviewStarting] = useState(false);

  const canStartPreview = useMemo(
    () =>
      canStartPortalPreviewAsAdmin(
        String(profile?.role ?? ""),
        profile?.globalRoles as string[] | undefined
      ),
    [profile?.role, profile?.globalRoles]
  );

  const orgPermissionsDirty = useMemo(() => {
    if (!employeeDoc) return false;
    const row = employeeDoc as Record<string, unknown>;
    const savedRole = parseEmployeePortalRole(row.role);
    const savedLevels = portalPermissionLevelsForAdminEditor(row, savedRole);
    const saved = orgPermissionsPayloadJson({
      portalRole: savedRole,
      moduleLevels: savedLevels,
      calendarLevels: calendarLevelsForAdminEditor(row, savedRole, savedLevels),
      visibleInTerminal: row.visibleInAttendanceTerminal !== false,
      dashboardAiAssistantEnabled: parseDashboardAiAssistantEnabled(row),
      cameraFlags: parseEmployeeCameraFlagsFromDoc(row),
    });
    const current = orgPermissionsPayloadJson({
      portalRole,
      moduleLevels,
      calendarLevels,
      visibleInTerminal,
      dashboardAiAssistantEnabled,
      cameraFlags,
    });
    return saved !== current;
  }, [
    employeeDoc,
    portalRole,
    moduleLevels,
    calendarLevels,
    visibleInTerminal,
    dashboardAiAssistantEnabled,
    cameraFlags,
  ]);

  useEffect(() => {
    if (!employeeDoc) return;
    if (orgPermissionsDirty) return;
    const role = parseEmployeePortalRole((employeeDoc as Record<string, unknown>).role);
    const row = employeeDoc as Record<string, unknown>;
    setPortalRole(role);
    const levels = portalPermissionLevelsForAdminEditor(row, role);
    setModuleLevels(levels);
    setCalendarLevels(calendarLevelsForAdminEditor(row, role, levels));
    setVisibleInTerminal(row.visibleInAttendanceTerminal !== false);
    setDashboardAiAssistantEnabled(parseDashboardAiAssistantEnabled(row));
    setCameraFlags(parseEmployeeCameraFlagsFromDoc(row));
  }, [employeeDoc, orgPermissionsDirty]);

  useEffect(() => {
    if (!orgPermissionsDirty || tab !== "roles") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [orgPermissionsDirty, tab]);

  const handleTabChange = useCallback(
    (next: typeof tab) => {
      if (tab === "roles" && next !== "roles" && orgPermissionsDirty) {
        const ok = window.confirm(
          "Máte neuložené změny oprávnění. Opravdu chcete opustit záložku bez uložení?"
        );
        if (!ok) return;
      }
      setTab(next);
    },
    [tab, orgPermissionsDirty]
  );

  const startPortalPreview = async () => {
    if (!user || !companyId || previewStarting) return;
    setPreviewStarting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/employees/portal-preview/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ employeeId, companyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Náhled nelze spustit.");
      }
      setPreviewDialogOpen(false);
      router.push("/portal/dashboard");
      router.refresh();
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Náhled se nepodařil",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setPreviewStarting(false);
    }
  };

  const confirmPortalRoleChange = useCallback(
    ({
      nextRole,
      currentRole,
    }: {
      nextRole: EmployeePortalRoleId;
      currentRole: EmployeePortalRoleId;
    }) => {
      if (nextRole === currentRole) return true;
      if (!employeeDoc) return true;
      if (
        employeeHasExplicitPortalModuleMatrix(employeeDoc as Record<string, unknown>)
      ) {
        return window.confirm(
          "Změna role přepíše individuálně nastavená oprávnění modulů na výchozí hodnoty pro novou roli. Pokračovat?"
        );
      }
      return true;
    },
    [employeeDoc]
  );

  const saveOrg = async () => {
    if (!canManageOrgRoles || !user || orgSaving) return;
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
          role: portalRole,
          visibleInAttendanceTerminal: visibleInTerminal,
          portalModulePermissions: (() => {
            const schedule = aggregateScheduleModuleLevel(calendarLevels);
            const full: Record<string, string> = {};
            for (const id of ALL_PORTAL_MODULE_IDS) {
              full[id] =
                id === "schedule" ? schedule : moduleLevels[id] ?? "none";
            }
            return full;
          })(),
          calendarPermissions: normalizeCalendarPermissionsForFirestore(calendarLevels),
          cameraPermissions: cameraFlags,
          dashboardAiAssistantEnabled,
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

  const cardCls = cn(
    belowLg
      ? "rounded-2xl border border-white/10 bg-slate-900/95 text-slate-100 shadow-lg"
      : "border-slate-200 bg-white"
  );
  const cardTitleCls = belowLg ? "text-base font-semibold text-white" : "text-lg text-black";
  const cardSubCls = belowLg ? "text-sm text-slate-400" : "text-sm text-slate-700";
  const labelCls = belowLg ? "text-xs text-slate-400" : "text-xs text-slate-600";
  const valueCls = belowLg
    ? "text-sm font-medium text-slate-100 break-words"
    : "font-medium text-black";
  const inputCls = belowLg
    ? "w-full border-white/15 bg-slate-950 text-slate-50 placeholder:text-slate-500"
    : "";
  const selectCls = cn(
    "h-10 w-full rounded-md border px-3 text-sm",
    belowLg
      ? "border-white/15 bg-slate-950 text-slate-50"
      : "border-slate-300 bg-white"
  );
  const saveBtnCls = cn(
    "h-11",
    belowLg &&
      "w-full min-h-11 rounded-xl bg-orange-500 font-medium text-slate-950 hover:bg-orange-400"
  );
  const outlineBtnCls = cn(
    "min-h-11 rounded-xl",
    belowLg && "w-full border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
  );
  const tabTriggerCls = cn(
    "h-10 shrink-0 px-3 text-sm",
    belowLg &&
      "rounded-xl border border-white/10 bg-slate-900 text-slate-300 data-[state=active]:border-orange-500/50 data-[state=active]:bg-orange-500/15 data-[state=active]:text-orange-200"
  );
  const payrollHref = `/portal/labor/vyplaty?employee=${encodeURIComponent(employeeId)}`;

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-5xl space-y-4",
        belowLg
          ? "max-w-none min-h-[100dvh] overflow-x-hidden bg-slate-950 px-3 pb-[calc(96px+env(safe-area-inset-bottom,0px))] pt-4"
          : "px-2 pb-12 sm:px-4"
      )}
    >
      {belowLg ? (
        <div className={cn(cardCls, "space-y-4 p-4")}>
          <Button
            type="button"
            variant="outline"
            className={cn(outlineBtnCls, "h-10 w-auto self-start px-3")}
            onClick={() => router.push("/portal/employees")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Zaměstnanci
          </Button>
          <div className="flex items-start gap-3">
            <Avatar className="h-16 w-16 shrink-0 border-2 border-white/15">
              <AvatarImage src={photoUrl || undefined} className="object-cover" alt="" />
              <AvatarFallback className="bg-orange-500/20 text-lg text-orange-200">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="break-words text-xl font-bold leading-tight text-white">{display}</h1>
              {companyName ? <p className="text-xs text-slate-400">{companyName}</p> : null}
              <p className="break-all text-sm text-slate-300">
                {String(employeeDoc?.email ?? "—")}
              </p>
              <p className="text-sm text-slate-400">
                {String(employeeDoc?.phone ?? employeeDoc?.phoneNumber ?? "—")}
              </p>
              <p className="text-sm text-slate-400">
                {String((employeeDoc as { jobTitle?: string })?.jobTitle ?? "—")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={isActive ? "default" : "secondary"}
              className={cn(
                "capitalize",
                isActive
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                  : "border-slate-500/50 bg-slate-800 text-slate-300"
              )}
            >
              {isActive ? "Aktivní" : "Neaktivní"}
            </Badge>
            <Badge variant="outline" className="border-white/15 bg-white/5 text-slate-300">
              {terminal.hasPin ? "PIN nastaven" : "Bez PINu"}
            </Badge>
          </div>
          {canManage ? (
            <Button
              type="button"
              variant={isActive ? "destructive" : "default"}
              className={cn(
                "min-h-11 w-full rounded-xl font-medium",
                !isActive && "bg-orange-500 text-slate-950 hover:bg-orange-400"
              )}
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
          <div className="grid grid-cols-1 gap-2 border-t border-white/10 pt-4 sm:grid-cols-2">
            <Button type="button" variant="outline" className={outlineBtnCls} asChild>
              <Link href="/portal/labor/dochazka/prehled">
                <Clock className="mr-2 h-4 w-4 shrink-0" />
                Docházka
              </Link>
            </Button>
            <Button type="button" variant="outline" className={outlineBtnCls} asChild>
              <Link href={payrollHref}>
                <DollarSign className="mr-2 h-4 w-4 shrink-0" />
                Výplaty
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(outlineBtnCls, "sm:col-span-2")}
              asChild
            >
              <Link href={payrollHref}>
                <Wallet className="mr-2 h-4 w-4 shrink-0" />
                Zálohy a dluhy
              </Link>
            </Button>
          </div>
        </div>
      ) : (
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
              <p className={cardSubCls}>
                {companyName ? `${companyName} · ` : ""}Detail zaměstnance
              </p>
            </div>
            <h1 className="mt-2 break-words text-xl font-bold text-black sm:text-2xl">
              {display}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isActive ? "default" : "secondary"} className="capitalize">
              {isActive ? "Aktivní" : "Neaktivní"}
            </Badge>
            {canStartPreview ? (
              <Button
                type="button"
                variant="outline"
                className="h-10"
                onClick={() => setPreviewDialogOpen(true)}
              >
                <Eye className="mr-2 h-4 w-4" />
                Zobrazit jako zaměstnanec
              </Button>
            ) : null}
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
      )}

      {employeeError ? (
        <Alert variant="destructive">
          <AlertTitle>Nelze načíst zaměstnance</AlertTitle>
          <AlertDescription>
            Zkuste stránku obnovit. Pokud problém přetrvá, zkontrolujte oprávnění.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => handleTabChange(v as typeof tab)} className="w-full">
        <TabsList
          className={cn(
            "flex h-auto w-full gap-1.5 bg-transparent p-0",
            belowLg
              ? "flex-nowrap overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]"
              : "flex-wrap justify-start"
          )}
        >
          <TabsTrigger value="overview" className={tabTriggerCls}>
            {belowLg ? "Přehled" : "Přehled"}
          </TabsTrigger>
          <TabsTrigger value="personal" className={tabTriggerCls}>
            {belowLg ? "Profil" : "Osobní údaje"}
          </TabsTrigger>
          <TabsTrigger value="work" className={tabTriggerCls}>
            {belowLg ? "Mzda" : "Práce a mzda"}
          </TabsTrigger>
          <TabsTrigger value="terminal" className={tabTriggerCls}>
            {belowLg ? "PIN" : "Terminál a PIN"}
          </TabsTrigger>
          <TabsTrigger value="roles" className={tabTriggerCls}>
            {belowLg ? "Role" : "Role a oprávnění"}
          </TabsTrigger>
          <TabsTrigger value="jobs" className={tabTriggerCls}>
            {belowLg ? "Zakázky" : "Přiřazené zakázky"}
          </TabsTrigger>
          <TabsTrigger value="documents" className={tabTriggerCls}>
            Dokumenty
          </TabsTrigger>
          <TabsTrigger value="contracts" className={tabTriggerCls}>
            {belowLg ? "Smlouvy" : "Smlouvy a dohody"}
          </TabsTrigger>
          <TabsTrigger value="photos" className={tabTriggerCls}>
            {belowLg ? "Foto" : "Fotodokumentace"}
          </TabsTrigger>
          <TabsTrigger value="signatures" className={tabTriggerCls}>
            Podpisy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className={cardCls}>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className={cardTitleCls}>Přehled</CardTitle>
                <p className={cardSubCls}>
                  Rychlý souhrn + stav. Úpravy jsou v dalších záložkách.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Avatar
                  className={cn(
                    "h-16 w-16 border",
                    belowLg ? "border-white/15" : "border-slate-200"
                  )}
                >
                  <AvatarImage src={photoUrl || undefined} className="object-cover" alt="" />
                  <AvatarFallback
                    className={cn(
                      belowLg ? "bg-orange-500/20 text-orange-200" : "bg-slate-100 text-slate-900"
                    )}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
            </CardHeader>
            <CardContent>
              {employeeLoading ? (
                <div
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    belowLg ? "text-slate-300" : "text-slate-800"
                  )}
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Načítání profilu…
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className={labelCls}>Jméno</Label>
                    <p className={valueCls}>{display}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>E-mail</Label>
                    <p className={valueCls}>{String(employeeDoc?.email ?? "—")}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Telefon</Label>
                    <p className={valueCls}>
                      {String(employeeDoc?.phone ?? employeeDoc?.phoneNumber ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Pozice</Label>
                    <p className={valueCls}>
                      {String((employeeDoc as any)?.jobTitle ?? "—")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Hodinová sazba</Label>
                    <p className={valueCls}>
                      {(employeeDoc as any)?.hourlyRate != null ? `${String((employeeDoc as any).hourlyRate)} Kč/h` : "—"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className={labelCls}>Terminál</Label>
                    <p className={valueCls}>
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
          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Osobní údaje</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex items-center gap-4">
                  <Avatar
                    className={cn(
                      "h-28 w-28 border",
                      belowLg ? "border-white/15" : "border-slate-200"
                    )}
                  >
                    <AvatarImage src={photoUrl || undefined} className="object-cover" alt="" />
                    <AvatarFallback
                      className={cn(
                        "text-2xl",
                        belowLg ? "bg-orange-500/20 text-orange-200" : "bg-slate-100 text-slate-900"
                      )}
                    >
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="flex-1 space-y-2">
                  <Label className={cn("text-sm", belowLg ? "text-slate-200" : "text-black")}>
                    Profilová fotka
                  </Label>
                  <Input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    disabled={!canManage || photoBusy}
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="default" className={cn("h-10", belowLg && "w-full min-h-11 rounded-xl bg-orange-500 text-slate-950 hover:bg-orange-400")} disabled={!canManage || photoBusy || !photoFile} onClick={() => void uploadPhoto()}>
                      {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      Nahrát
                    </Button>
                    <Button type="button" variant="outline" className="h-10" disabled={!canManage || photoBusy || !photoUrl} onClick={() => void clearPhoto()}>
                      Odebrat fotku
                    </Button>
                  </div>
                  <p className={cn("text-xs", belowLg ? "text-slate-400" : "text-slate-600")}>
                    Fotka se uloží do Firebase Storage a url se uloží do záznamu zaměstnance.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Jméno</Label>
                  <Input className={inputCls} value={personalForm.firstName} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, firstName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Příjmení</Label>
                  <Input className={inputCls} value={personalForm.lastName} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, lastName: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input className={inputCls} value={personalForm.email} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Telefon</Label>
                  <Input className={inputCls} value={personalForm.phone} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, phone: e.target.value }))} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Adresa</Label>
                  <Input className={inputCls} value={personalForm.address} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, address: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Pracovní pozice</Label>
                  <Input className={inputCls} value={personalForm.jobTitle} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, jobTitle: e.target.value }))} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Poznámka</Label>
                  <Textarea value={personalForm.note} disabled={!canManage} onChange={(e) => setPersonalForm((p) => ({ ...p, note: e.target.value }))} className="min-h-[110px]" />
                </div>
              </div>
              <div className={cn("flex justify-end", belowLg && "w-full")}>
                <Button type="button" className={saveBtnCls} disabled={!canManage || savingPersonal} onClick={() => void savePersonal()}>
                  {savingPersonal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit osobní údaje
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Portál — e-mailová upozornění</CardTitle>
              <p className="text-sm text-slate-600 font-normal pt-1">
                Nastavení se ukládá na propojený uživatelský účet (Firebase Auth). Zaměstnanec si totéž může upravit
                ve svém profilu v portálu.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {portalNotifLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Načítání…
                </div>
              ) : !portalNotifForm ? (
                <p className={cardSubCls}>Nastavení se nepodařilo načíst.</p>
              ) : !portalNotifForm.linked ? (
                <p className={cardSubCls}>
                  Zaměstnanec nemá propojený účet portálu — e-mailová upozornění zatím nelze spravovat z administrace.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <Label className="text-sm text-black">E-mail — chat u zakázky</Label>
                      <p className="text-xs text-slate-600 max-w-xl">
                        Nepřečtené zprávy v obecném chatu k zakázce (max. jednou za 24 h u stejného vlákna).
                      </p>
                    </div>
                    <Switch
                      checked={portalNotifForm.emailMessageNotificationsEnabled}
                      disabled={!canManage || portalNotifSaving}
                      onCheckedChange={(v) =>
                        setPortalNotifForm((p) =>
                          p ? { ...p, emailMessageNotificationsEnabled: v === true } : p
                        )
                      }
                    />
                  </div>
                  <div className="border-t border-slate-200 pt-4 space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <Label className="text-sm text-black">E-mail — nepřečtené poznámky u fotodokumentace</Label>
                        <p className="text-xs text-slate-600 max-w-xl">
                          Pošleme e-mail po nastaveném intervalu, pokud má zaměstnanec nepřečtenou poznámku u souboru
                          ve fotodokumentaci.
                        </p>
                      </div>
                      <Switch
                        checked={portalNotifForm.emailUnreadPhotoNoteNotificationsEnabled}
                        disabled={!canManage || portalNotifSaving}
                        onCheckedChange={(v) =>
                          setPortalNotifForm((p) =>
                            p ? { ...p, emailUnreadPhotoNoteNotificationsEnabled: v === true } : p
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2 max-w-md">
                      <Label className="text-sm text-black">Interval upozornění</Label>
                      <Select
                        value={String(portalNotifForm.unreadNoteNotificationIntervalHours)}
                        disabled={!canManage || portalNotifSaving}
                        onValueChange={(v) => {
                          const n = Number(v);
                          if (
                            !UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS.includes(
                              n as UnreadPhotoNoteIntervalHours
                            )
                          ) {
                            return;
                          }
                          setPortalNotifForm((p) =>
                            p ? { ...p, unreadNoteNotificationIntervalHours: n as UnreadPhotoNoteIntervalHours } : p
                          );
                        }}
                      >
                        <SelectTrigger className="bg-white text-black border-slate-300">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNREAD_PHOTO_NOTE_INTERVAL_HOURS_OPTIONS.map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {unreadPhotoNoteIntervalLabelCs(h)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className={cn("flex justify-end", belowLg && "w-full")}>
                    <Button
                      type="button"
                      className="h-11"
                      disabled={!canManage || portalNotifSaving}
                      onClick={() => void savePortalNotifications()}
                    >
                      {portalNotifSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Uložit nastavení e-mailů portálu
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work" className="mt-4 space-y-4">
          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Práce a mzda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Hodinová sazba (Kč/h)</Label>
                  <Input className={inputCls} value={workForm.hourlyRate} disabled={!canManage} inputMode="decimal" onChange={(e) => setWorkForm((p) => ({ ...p, hourlyRate: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Typ mzdy</Label>
                  <select className={selectCls} disabled={!canManage} value={workForm.wageType} onChange={(e) => setWorkForm((p) => ({ ...p, wageType: e.target.value as any }))}>
                    <option value="hourly">Hodinová</option>
                    <option value="monthly">Měsíční</option>
                    <option value="other">Jiné</option>
                  </select>
                  <p className="text-xs text-slate-600">
                    Pokud vaše aplikace typ mzdy dosud neměla, ukládá se do pole <code>wageType</code> na zaměstnanci.
                  </p>
                </div>
              </div>

              <div className={cn("rounded-lg border p-4", belowLg ? "border-white/10 bg-slate-950/50" : "border-slate-200")}>
                <p className="text-sm font-semibold text-black">Bankovní účet (výplata)</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Číslo účtu</Label>
                    <Input className={inputCls} value={bankForm.accountNumber} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, accountNumber: e.target.value }))} placeholder="např. 19-123456789" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kód banky</Label>
                    <Input className={inputCls} value={bankForm.bankCode} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, bankCode: e.target.value }))} placeholder="např. 0100" />
                  </div>
                  <div className="space-y-2">
                    <Label>IBAN</Label>
                    <Input className={inputCls} value={bankForm.iban} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, iban: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>BIC/SWIFT</Label>
                    <Input className={inputCls} value={bankForm.bic} disabled={!canManage} onChange={(e) => setBankForm((b) => ({ ...b, bic: e.target.value }))} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Poznámka k výplatě</Label>
                    <Textarea
                      value={bankForm.paymentNote}
                      disabled={!canManage}
                      onChange={(e) => setBankForm((b) => ({ ...b, paymentNote: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div
                  className={cn(
                    "mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end",
                    belowLg && "w-full"
                  )}
                >
                  <Button type="button" className={saveBtnCls} disabled={!canManage || savingBank} onClick={() => void saveBank()}>
                    {savingBank ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Uložit bankovní účet
                  </Button>
                </div>
              </div>

              <div className={cn("flex justify-end", belowLg && "w-full")}>
                <Button type="button" className={saveBtnCls} disabled={!canManage || savingWork} onClick={() => void saveWork()}>
                  {savingWork ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit práci a mzdu
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="terminal" className="mt-4 space-y-4">
          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Terminál a PIN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className={labelCls}>Stav</Label>
                  <p className={valueCls}>
                    {terminal.hasPin ? "PIN nastaven" : "Bez PINu"}{terminal.needsChange ? " · změnit v profilu" : ""}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>PIN (ručně nastavit)</Label>
                  <Input className={inputCls} value={pinManual} disabled={!canManage || pinBusy} onChange={(e) => setPinManual(e.target.value)} placeholder="např. 1234" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className={cn("h-10 min-h-11", belowLg && "w-full rounded-xl bg-orange-500 text-slate-950 hover:bg-orange-400")} disabled={!canManage || pinBusy} onClick={() => void callPinAdmin("set")}>
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
          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Role a oprávnění</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  5. Docházkový terminál
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-black">Viditelný v docházkovém terminálu</p>
                    <p className="text-xs text-slate-600">
                      PIN a reset PINu spravujte v záložce Terminál a PIN.
                    </p>
                  </div>
                  <Switch
                    checked={visibleInTerminal}
                    disabled={!canManageOrgRoles}
                    onCheckedChange={(v) => setVisibleInTerminal(v)}
                  />
                </div>
              </div>

              {!canManageOrgRoles ? (
                <Alert>
                  <AlertTitle>Správa rolí a oprávnění</AlertTitle>
                  <AlertDescription>
                    Role, matice modulů a viditelnost v terminálu může měnit pouze vlastník nebo
                    administrátor organizace.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                <EmployeeEffectiveAccessPanel
                  employeeDoc={employeeDoc as Record<string, unknown>}
                  portalRole={portalRole}
                />
                <EmployeePortalRolePermissionsEditor
                  disabled={!canManageOrgRoles}
                  portalRole={portalRole}
                  onPortalRoleChange={setPortalRole}
                  confirmRoleChange={confirmPortalRoleChange}
                  levels={moduleLevels}
                  onLevelsChange={setModuleLevels}
                  calendarLevels={calendarLevels}
                  onCalendarLevelsChange={setCalendarLevels}
                  dashboardAiAssistantEnabled={dashboardAiAssistantEnabled}
                  onDashboardAiAssistantEnabledChange={setDashboardAiAssistantEnabled}
                  roleSelectClassName={selectCls}
                />
                </>
              )}

              {canManageOrgRoles ? (
                <EmployeeCameraPermissionsBlock
                  flags={cameraFlags}
                  onChange={setCameraFlags}
                  disabled={!canManageOrgRoles}
                />
              ) : null}

              {orgPermissionsDirty ? (
                <Alert variant="default" className="border-amber-300 bg-amber-50">
                  <AlertTitle>Neuložené změny</AlertTitle>
                  <AlertDescription>
                    Role nebo oprávnění byly upraveny. Uložte je tlačítkem „Uložit oprávnění“, jinak se
                    po obnovení stránky vrátí původní hodnoty.
                  </AlertDescription>
                </Alert>
              ) : null}

              {canStartPreview ? (
                <div className="rounded-md border border-orange-200 bg-orange-50/80 p-4 space-y-2">
                  <p className="text-sm font-semibold text-black">6. Náhled zaměstnaneckého portálu</p>
                  <p className="text-xs text-slate-700">
                    Otevře portál s oprávněními tohoto zaměstnance v režimu pouze pro čtení.
                  </p>
                  <Button type="button" variant="outline" className="h-10" onClick={() => setPreviewDialogOpen(true)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Zobrazit jako zaměstnanec
                  </Button>
                </div>
              ) : null}

              <div className={cn("flex justify-end", belowLg && "w-full")}>
                <Button
                  type="button"
                  className={saveBtnCls}
                  disabled={!canManageOrgRoles || orgSaving}
                  onClick={() => void saveOrg()}
                >
                  {orgSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Uložit oprávnění
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-4">
          <Card className={cardCls}>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className={cardTitleCls}>Přiřazené zakázky</CardTitle>
                <p className={cardSubCls}>
                  Přiřazení se ukládá na zaměstnance i na zakázku a vytváří se i záznam v <code>jobMembers</code>.
                </p>
              </div>
              <Button type="button" className={saveBtnCls} disabled={!canManage || jobsSaving} onClick={() => void saveAssignedJobs()}>
                {jobsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Uložit přiřazení
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {companyJobs.length === 0 ? (
                <p className={cardSubCls}>Žádné zakázky.</p>
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
                      <span className={cn("ml-auto text-xs text-slate-500", belowLg && "hidden")}>{j.id}</span>
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
            <p className={cardSubCls}>
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
          <Card className={cardCls}>
            <CardHeader>
              <CardTitle className={cardTitleCls}>Podpisy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className={cardSubCls}>
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

      <AlertDialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <AlertDialogContent data-portal-dialog>
          <AlertDialogHeader>
            <AlertDialogTitle>Náhled portálu zaměstnance</AlertDialogTitle>
            <AlertDialogDescription>
              Chcete zobrazit portál tak, jak jej vidí {display}? Režim je pouze pro čtení — změny dat
              nejsou povoleny.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={previewStarting}>Zrušit</AlertDialogCancel>
            <Button type="button" disabled={previewStarting} onClick={() => void startPortalPreview()}>
              {previewStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spustit náhled"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

