"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_EMPLOYEE_PASSWORD_LENGTH } from "@/lib/employee-password-policy";
import {
  buildAccountantPermissionPreset,
  buildManagerPermissionPreset,
  buildOrgAdminPermissionPreset,
  PORTAL_PERMISSION_MODULES,
  type PortalAccessLevel,
  type PortalModuleId,
} from "@/lib/portal-permissions";
import {
  aggregateScheduleModuleLevel,
  normalizeCalendarPermissionsForFirestore,
  type CalendarSubPermissionKey,
} from "@/lib/calendar/calendar-access";
import {
  buildNewEmployeePermissionPreset,
  calendarLevelsForAdminEditor,
  defaultCalendarLevelsForNewEmployee,
} from "@/lib/portal-permissions-admin";
import { EmployeePortalRolePermissionsEditor } from "@/components/employees/employee-portal-role-permissions-editor";
import {
  EMPLOYEE_PORTAL_ROLE_OPTIONS,
  parseEmployeePortalRole,
  type EmployeePortalRoleId,
} from "@/lib/employee-portal-role";
import { DollarSign } from "lucide-react";

const INVITE_INPUT_CLASS =
  "flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-base text-black ring-offset-0 placeholder:text-gray-600 focus-visible:border-orange-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:ring-offset-0 md:text-sm disabled:opacity-70";

const INVITE_LABEL_CLASS = "text-sm font-medium text-gray-700";

const ACCESS_LABELS: Record<PortalAccessLevel, string> = {
  none: "Bez přístupu",
  read: "Náhled",
  write: "Zápis",
};

export type EmployeeInviteWizardProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (payload: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    jobTitle: string;
    hourlyRate: number | null;
    orgRole: EmployeePortalRoleId;
    visibleInAttendanceTerminal: boolean;
    portalModulePermissions: Record<string, string> | null;
    calendarPermissions: Record<string, string> | null;
    dashboardAiAssistantEnabled: boolean;
  }) => Promise<void>;
  trigger?: React.ReactNode;
};

function levelsForNewInviteRole(role: EmployeePortalRoleId): Record<PortalModuleId, PortalAccessLevel> {
  if (role === "orgAdmin") return buildOrgAdminPermissionPreset();
  if (role === "accountant") return buildAccountantPermissionPreset();
  if (role === "manager") return buildManagerPermissionPreset();
  return buildNewEmployeePermissionPreset();
}

function buildPermissionsPayload(
  orgRole: EmployeePortalRoleId,
  moduleLevels: Record<PortalModuleId, PortalAccessLevel>,
  calendarLevels: Record<CalendarSubPermissionKey, PortalAccessLevel>
): {
  portalModulePermissions: Record<string, string> | null;
  calendarPermissions: Record<string, string> | null;
} {
  if (orgRole === "orgAdmin") {
    return { portalModulePermissions: null, calendarPermissions: null };
  }
  const schedule = aggregateScheduleModuleLevel(calendarLevels);
  const portalModulePermissions: Record<string, string> = {};
  for (const mod of PORTAL_PERMISSION_MODULES) {
    const id = mod.id as PortalModuleId;
    portalModulePermissions[id] =
      id === "schedule" ? schedule : moduleLevels[id] ?? "none";
  }
  return {
    portalModulePermissions,
    calendarPermissions: normalizeCalendarPermissionsForFirestore(calendarLevels),
  };
}

export function EmployeeInviteWizard(props: EmployeeInviteWizardProps) {
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [orgRole, setOrgRole] = useState<EmployeePortalRoleId>("employee");
  const [visibleInTerminal, setVisibleInTerminal] = useState(true);
  const [moduleLevels, setModuleLevels] = useState(() => buildNewEmployeePermissionPreset());
  const [calendarLevels, setCalendarLevels] = useState(defaultCalendarLevelsForNewEmployee);
  const [dashboardAi, setDashboardAi] = useState(true);

  const reset = useCallback(() => {
    setStep(1);
    setFirstName("");
    setLastName("");
    setEmail("");
    setJobTitle("");
    setHourlyRate("");
    setPassword("");
    setPasswordConfirm("");
    setOrgRole("employee");
    setVisibleInTerminal(true);
    setModuleLevels(buildNewEmployeePermissionPreset());
    setCalendarLevels(defaultCalendarLevelsForNewEmployee());
    setDashboardAi(true);
  }, []);

  const handleOpenChange = (open: boolean) => {
    props.onOpenChange(open);
    if (!open) reset();
  };

  const applyRoleDefaults = (role: EmployeePortalRoleId) => {
    setOrgRole(role);
    const next = levelsForNewInviteRole(role);
    setModuleLevels(next);
    setCalendarLevels(
      calendarLevelsForAdminEditor(null, role, next)
    );
  };

  const summaryPermissions = useMemo(() => {
    const { portalModulePermissions } = buildPermissionsPayload(orgRole, moduleLevels, calendarLevels);
    if (!portalModulePermissions) return [];
    const rows: { label: string; level: PortalAccessLevel }[] = [
      { label: "Kalendář — Schůzky", level: calendarLevels.meetings },
      { label: "Kalendář — Montáže", level: calendarLevels.installations },
    ];
    for (const mod of PORTAL_PERMISSION_MODULES) {
      if (mod.id === "schedule") continue;
      const level = moduleLevels[mod.id as PortalModuleId] ?? "none";
      if (level !== "none") rows.push({ label: mod.label, level });
    }
    return rows;
  }, [orgRole, moduleLevels, calendarLevels]);

  const enabledCount = summaryPermissions.filter((r) => r.level !== "none").length;

  const goNext = () => {
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    }
    if (step === 2 && orgRole === "orgAdmin") {
      setStep(4);
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const handleCreate = async () => {
    if (password.length < MIN_EMPLOYEE_PASSWORD_LENGTH) return;
    if (password !== passwordConfirm) return;
    const rateStr = hourlyRate.trim();
    const rateParsed = rateStr === "" ? null : Number(rateStr.replace(",", "."));
    const { portalModulePermissions, calendarPermissions } = buildPermissionsPayload(
      orgRole,
      moduleLevels,
      calendarLevels
    );
    await props.onSubmit({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      password,
      jobTitle: jobTitle.trim(),
      hourlyRate:
        rateParsed != null && Number.isFinite(rateParsed) && rateParsed >= 0
          ? rateParsed
          : null,
      orgRole,
      visibleInAttendanceTerminal: visibleInTerminal,
      portalModulePermissions,
      calendarPermissions,
      dashboardAiAssistantEnabled: dashboardAi,
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      {props.trigger ? <DialogTrigger asChild>{props.trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200 bg-white p-6 text-black shadow-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-black">
            Přidat zaměstnance — krok {step} ze 4
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-700">
            {step === 1 && "Osobní údaje a heslo pro přihlášení."}
            {step === 2 && "Role určuje výchozí předvolbu oprávnění."}
            {step === 3 && "Nastavte přístup k modulům před vytvořením účtu."}
            {step === 4 && "Zkontrolujte souhrn a potvrďte vytvoření."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className={INVITE_LABEL_CLASS}>Jméno</Label>
                <Input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={INVITE_INPUT_CLASS}
                />
              </div>
              <div className="space-y-2">
                <Label className={INVITE_LABEL_CLASS}>Příjmení</Label>
                <Input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={INVITE_INPUT_CLASS}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className={INVITE_LABEL_CLASS}>E-mail</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INVITE_INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label className={INVITE_LABEL_CLASS}>Pozice</Label>
              <Input
                placeholder="Např. Svářeč"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className={INVITE_INPUT_CLASS}
              />
            </div>
            <div className="space-y-2">
              <Label className={INVITE_LABEL_CLASS}>Hodinová sazba (Kč/h)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
                <Input
                  type="number"
                  className={cn(INVITE_INPUT_CLASS, "pl-10")}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className={INVITE_LABEL_CLASS}>Heslo</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_EMPLOYEE_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={INVITE_INPUT_CLASS}
                />
              </div>
              <div className="space-y-2">
                <Label className={INVITE_LABEL_CLASS}>Potvrzení hesla</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className={INVITE_INPUT_CLASS}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50/80 p-3">
              <Label className={INVITE_LABEL_CLASS}>Zobrazit v terminálu docházky</Label>
              <Switch checked={visibleInTerminal} onCheckedChange={setVisibleInTerminal} />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3 py-2">
            <Label className={INVITE_LABEL_CLASS}>Role v organizaci</Label>
            <select
              className={INVITE_INPUT_CLASS}
              value={orgRole}
              onChange={(e) => applyRoleDefaults(parseEmployeePortalRole(e.target.value))}
            >
              {EMPLOYEE_PORTAL_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-600">
              Pro roli Zaměstnanec jsou v dalším kroku výchozí všechna pracovní oprávnění vypnutá.
              U ostatních rolí se načte předvolba — v kroku 3 ji můžete upravit.
            </p>
          </div>
        ) : null}

        {step === 3 && orgRole !== "orgAdmin" ? (
          <EmployeePortalRolePermissionsEditor
            portalRole={orgRole}
            onPortalRoleChange={applyRoleDefaults}
            levels={moduleLevels}
            onLevelsChange={setModuleLevels}
            calendarLevels={calendarLevels}
            onCalendarLevelsChange={setCalendarLevels}
            dashboardAiAssistantEnabled={dashboardAi}
            onDashboardAiAssistantEnabledChange={setDashboardAi}
            confirmRoleChange={() => true}
          />
        ) : null}

        {step === 4 ? (
          <div className="space-y-4 py-2 text-sm">
            <div className="rounded-md border border-gray-200 p-3 space-y-1">
              <p className="font-semibold">Nový zaměstnanec</p>
              <p>
                {firstName} {lastName}
              </p>
              <p className="text-gray-700">{email}</p>
              <p>
                Role:{" "}
                {EMPLOYEE_PORTAL_ROLE_OPTIONS.find((o) => o.value === orgRole)?.label ?? orgRole}
              </p>
            </div>
            {orgRole !== "orgAdmin" ? (
              <div className="rounded-md border border-gray-200 p-3">
                <p className="font-semibold mb-2">
                  Povolené moduly ({enabledCount})
                </p>
                {summaryPermissions.length === 0 ? (
                  <p className="text-gray-600 text-xs">Žádné pracovní moduly.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {summaryPermissions.map((row) => (
                      <li key={row.label} className="flex justify-between gap-2">
                        <span>{row.label}</span>
                        <span>{ACCESS_LABELS[row.level]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-gray-700">Administrátor organizace — plný přístup k portálu.</p>
            )}
          </div>
        ) : null}

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            {step > 1 ? (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                Zpět
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {step < 4 ? (
              <Button type="button" onClick={goNext}>
                Pokračovat
              </Button>
            ) : (
              <Button type="button" disabled={props.isSubmitting} onClick={() => void handleCreate()}>
                {props.isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Vytvořit zaměstnance a odeslat pozvánku"
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeInviteWizardTriggerButton() {
  return (
    <Button className="gap-2">
      <UserPlus className="w-4 h-4" /> Pozvat zaměstnance
    </Button>
  );
}
