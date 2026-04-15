"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { collection } from "firebase/firestore";
import {
  useFirestore,
  useCollection,
  useMemoFirebase,
  useUser,
} from "@/firebase";
import { getAuth } from "firebase/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  type EmailModuleKey,
  type EmailNotificationsSettings,
  mergeEmailNotifications,
  CALENDAR_REMINDER_OFFSET_OPTIONS,
} from "@/lib/email-notifications/schema";
import { MODULE_EVENT_LABELS, MODULE_SECTION_TITLES } from "@/lib/email-notifications/ui-labels";
import { Mail, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type EmployeeRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  authUserId?: string;
};

type RecipientIdLists = { userIds: string[]; employeeIds: string[] };

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function isEmpSelected(emp: EmployeeRow, lists: RecipientIdLists): boolean {
  const uid = emp.authUserId?.trim();
  if (uid && lists.userIds.includes(uid)) return true;
  return lists.employeeIds.includes(emp.id);
}

function toggleEmpInLists(emp: EmployeeRow, checked: boolean, lists: RecipientIdLists): RecipientIdLists {
  const uid = emp.authUserId?.trim();
  const u = new Set(lists.userIds);
  const e = new Set(lists.employeeIds);
  if (checked) {
    if (uid) {
      u.add(uid);
      e.delete(emp.id);
    } else {
      e.add(emp.id);
    }
  } else {
    if (uid) u.delete(uid);
    e.delete(emp.id);
  }
  return { userIds: [...u], employeeIds: [...e] };
}

const MODULE_ORDER: EmailModuleKey[] = [
  "orders",
  "documents",
  "invoices",
  "leads",
  "calendar",
  "warehouse",
  "attendance",
  "messages",
  "system",
];

function EmployeeRecipientList(props: {
  idPrefix: string;
  employees: EmployeeRow[];
  employeesLoading: boolean;
  lists: RecipientIdLists;
  onToggle: (emp: EmployeeRow, checked: boolean) => void;
  disabled?: boolean;
}) {
  const { idPrefix, employees, employeesLoading, lists, onToggle, disabled } = props;
  return (
    <div className="space-y-2">
      <Label>Vybraní zaměstnanci</Label>
      <div
        className={cn(
          "rounded-lg border border-border bg-background",
          employeesLoading && "opacity-70",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <ScrollArea className="h-[min(200px,35vh)] p-3">
          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {employeesLoading ? "Načítání…" : "Žádní zaměstnanci."}
            </p>
          ) : (
            <ul className="space-y-2">
              {employees.map((emp) => {
                const label =
                  `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() || emp.email || emp.id;
                const checked = isEmpSelected(emp, lists);
                return (
                  <li key={emp.id} className="flex items-start gap-3 min-h-[44px]">
                    <Checkbox
                      id={`${idPrefix}-${emp.id}`}
                      checked={checked}
                      onCheckedChange={(v) => onToggle(emp, v === true)}
                      disabled={disabled}
                      className="mt-1"
                    />
                    <label
                      htmlFor={`${idPrefix}-${emp.id}`}
                      className="flex flex-col cursor-pointer flex-1 min-w-0"
                    >
                      <span className="text-sm font-medium leading-tight">{label}</span>
                      {emp.email ? (
                        <span className="text-xs text-muted-foreground truncate">{emp.email}</span>
                      ) : (
                        <span className="text-xs text-amber-600">
                          Bez e-mailu v profilu — u účtovaného zaměstnance se e-mail nepoužije.
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

function ManualEmailChips(props: {
  emails: string[];
  onRemove: (e: string) => void;
  disabled?: boolean;
}) {
  const { emails, onRemove, disabled } = props;
  if (emails.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 pt-1">
      {emails.map((r) => (
        <li
          key={r}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 pl-2.5 pr-1 py-0.5 text-sm"
        >
          <span className="max-w-[200px] truncate">{r}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onRemove(r)}
            disabled={disabled}
            aria-label={`Odebrat ${r}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function EmailNotificationsSettings(props: {
  companyId: string | undefined;
  company: Record<string, unknown> | null | undefined;
}) {
  const { companyId, company } = props;
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [draft, setDraft] = useState<EmailNotificationsSettings>(() =>
    mergeEmailNotifications((company as { emailNotifications?: unknown })?.emailNotifications)
  );
  const [isDirty, setIsDirty] = useState(false);
  const lastAppliedRemoteJsonRef = useRef<string | null>(null);
  const postSaveIgnoreSnapshotsRef = useRef(0);
  /** První hydratace z merged company — další sync jen při změně remoteJson a !isDirty. */
  const hasHydratedFromPropsRef = useRef(false);
  const [globalEmailInput, setGlobalEmailInput] = useState("");
  const [moduleEmailInputs, setModuleEmailInputs] = useState<Partial<Record<EmailModuleKey, string>>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [moduleTesting, setModuleTesting] = useState<EmailModuleKey | null>(null);

  const patchDraft = (updater: SetStateAction<EmailNotificationsSettings>) => {
    setIsDirty(true);
    setDraft(updater);
  };

  const remoteRaw = (company as { emailNotifications?: unknown } | null | undefined)
    ?.emailNotifications;
  const remoteJson = useMemo(() => {
    try {
      return JSON.stringify(remoteRaw ?? null);
    } catch {
      return '"<unserializable>"';
    }
  }, [remoteRaw]);

  useEffect(() => {
    if (!companyId) return;

    if (typeof window !== "undefined") {
      console.debug("[email-notifications-settings] listener tick", {
        companyId,
        isDirty,
        postSaveIgnoreSnapshots: postSaveIgnoreSnapshotsRef.current,
        remoteChanged: remoteJson !== lastAppliedRemoteJsonRef.current,
      });
    }

    if (postSaveIgnoreSnapshotsRef.current > 0) {
      postSaveIgnoreSnapshotsRef.current -= 1;
      if (typeof window !== "undefined") {
        console.debug(
          "[email-notifications-settings] skip Firestore snapshot (post-save echo / race)"
        );
      }
      return;
    }

    if (remoteJson === lastAppliedRemoteJsonRef.current) {
      return;
    }

    if (isDirty) {
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] skip sync: edited form (dirty)");
      }
      return;
    }

    if (typeof window !== "undefined") {
      console.debug("[email-notifications-settings] load from DB into form", {
        rawFromMergedCompany: remoteRaw,
        firstHydrate: !hasHydratedFromPropsRef.current,
      });
    }
    hasHydratedFromPropsRef.current = true;
    lastAppliedRemoteJsonRef.current = remoteJson;
    setDraft(mergeEmailNotifications(remoteRaw));
  }, [companyId, remoteJson, remoteRaw, isDirty]);

  const employeesColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, COMPANIES_COLLECTION, companyId, "employees")
        : null,
    [firestore, companyId]
  );

  const { data: employeesRaw = [], isLoading: employeesLoading } =
    useCollection<EmployeeRow>(employeesColRef);

  const employees = useMemo(() => {
    const list = (employeesRaw ?? []) as EmployeeRow[];
    return list
      .filter((e) => e?.id)
      .sort((a, b) => {
        const na = `${a.lastName ?? ""} ${a.firstName ?? ""}`.trim().toLowerCase();
        const nb = `${b.lastName ?? ""} ${b.firstName ?? ""}`.trim().toLowerCase();
        return na.localeCompare(nb, "cs");
      });
  }, [employeesRaw]);

  const globalLists: RecipientIdLists = {
    userIds: draft.globalRecipientUserIds,
    employeeIds: draft.globalRecipientEmployeeIds,
  };

  const toggleGlobalEmployee = (emp: EmployeeRow, checked: boolean) => {
    const next = toggleEmpInLists(emp, checked, globalLists);
    patchDraft((prev) => ({
      ...prev,
      globalRecipientUserIds: next.userIds,
      globalRecipientEmployeeIds: next.employeeIds,
    }));
  };

  const addGlobalManualEmail = () => {
    const e = globalEmailInput.trim().toLowerCase();
    if (!e) return;
    if (!isValidEmail(e)) {
      toast({
        variant: "destructive",
        title: "Neplatný e-mail",
        description: "Zadejte adresu ve tvaru jmeno@domena.cz.",
      });
      return;
    }
    patchDraft((prev) =>
      prev.globalRecipients.includes(e)
        ? prev
        : { ...prev, globalRecipients: [...prev.globalRecipients, e] }
    );
    setGlobalEmailInput("");
  };

  const removeGlobalManualEmail = (e: string) => {
    patchDraft((prev) => ({
      ...prev,
      globalRecipients: prev.globalRecipients.filter((x) => x !== e),
    }));
  };

  const setModuleEnabled = (module: EmailModuleKey, enabled: boolean) => {
    patchDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [module]: { ...prev.modules[module], enabled },
      },
    }));
  };

  const setModuleUseGlobalRecipients = (module: EmailModuleKey, useGlobal: boolean) => {
    patchDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [module]: { ...prev.modules[module], useGlobalRecipients: useGlobal },
      },
    }));
  };

  const setModuleEvent = (module: EmailModuleKey, eventKey: string, value: boolean) => {
    patchDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [module]: {
          ...prev.modules[module],
          [eventKey]: value,
        },
      },
    }));
  };

  const toggleModuleEmployee = (module: EmailModuleKey, emp: EmployeeRow, checked: boolean) => {
    patchDraft((prev) => {
      const m = prev.modules[module];
      const cur: RecipientIdLists = {
        userIds: m.recipientUserIds,
        employeeIds: m.recipientEmployeeIds,
      };
      const next = toggleEmpInLists(emp, checked, cur);
      return {
        ...prev,
        modules: {
          ...prev.modules,
          [module]: {
            ...m,
            recipientUserIds: next.userIds,
            recipientEmployeeIds: next.employeeIds,
          },
        },
      };
    });
  };

  const addModuleManualEmail = (module: EmailModuleKey) => {
    const raw = (moduleEmailInputs[module] ?? "").trim().toLowerCase();
    if (!raw) return;
    if (!isValidEmail(raw)) {
      toast({
        variant: "destructive",
        title: "Neplatný e-mail",
        description: "Zadejte adresu ve tvaru jmeno@domena.cz.",
      });
      return;
    }
    patchDraft((prev) => {
      const m = prev.modules[module];
      if (m.recipients.includes(raw)) return prev;
      return {
        ...prev,
        modules: {
          ...prev.modules,
          [module]: { ...m, recipients: [...m.recipients, raw] },
        },
      };
    });
    setModuleEmailInputs((p) => ({ ...p, [module]: "" }));
  };

  const removeModuleManualEmail = (module: EmailModuleKey, e: string) => {
    patchDraft((prev) => {
      const m = prev.modules[module];
      return {
        ...prev,
        modules: {
          ...prev.modules,
          [module]: { ...m, recipients: m.recipients.filter((x) => x !== e) },
        },
      };
    });
  };

  const toggleCalendarOffset = (minutes: number, checked: boolean) => {
    patchDraft((prev) => {
      const cur = new Set(prev.modules.calendar.reminderOffsetsMinutes);
      if (checked) cur.add(minutes);
      else cur.delete(minutes);
      const arr = [...cur].sort((a, b) => a - b);
      return {
        ...prev,
        modules: {
          ...prev.modules,
          calendar: {
            ...prev.modules.calendar,
            reminderOffsetsMinutes: arr.length ? arr : [15],
          },
        },
      };
    });
  };

  const handleSave = async () => {
    if (!companyId) return;
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      toast({
        variant: "destructive",
        title: "Nastavení notifikací se nepodařilo uložit.",
        description: "Nejste přihlášeni.",
      });
      return;
    }
    setSaving(true);
    try {
      const firestorePayload = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] save: form draft", draft);
        console.debug("[email-notifications-settings] save: payload keys", Object.keys(firestorePayload));
        console.debug(
          "[email-notifications-settings] save: POST /api/company/email-notifications/settings",
          { companyId }
        );
      }
      const token = await currentUser.getIdToken();
      const res = await fetch("/api/company/email-notifications/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId, emailNotifications: firestorePayload }),
      });
      const responseText = await res.text();
      let json: { ok?: boolean; error?: string } = {};
      try {
        json = responseText ? (JSON.parse(responseText) as { ok?: boolean; error?: string }) : {};
      } catch (parseErr) {
        console.error(
          "[email-notifications-settings] save: response is not JSON",
          res.status,
          responseText,
          parseErr
        );
        throw new Error(`Neplatná odpověď serveru (HTTP ${res.status}).`);
      }
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] save: response", {
          status: res.status,
          ok: res.ok,
          json,
        });
      }
      if (!res.ok || !json.ok) {
        console.error("[email-notifications-settings] save: API returned error", {
          status: res.status,
          json,
          responseText,
        });
        throw new Error(json.error || `Požadavek selhal (HTTP ${res.status}).`);
      }
      const normalized = mergeEmailNotifications(firestorePayload);
      const normalizedJson = JSON.stringify(firestorePayload);
      setDraft(normalized);
      setIsDirty(false);
      lastAppliedRemoteJsonRef.current = normalizedJson;
      postSaveIgnoreSnapshotsRef.current = 1;
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] save: server confirmed OK", normalized);
      }
      toast({
        title: "Uloženo",
        description: "Nastavení notifikací bylo uloženo.",
      });
    } catch (e) {
      console.error("[email-notifications-settings] save: failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: "Nastavení notifikací se nepodařilo uložit.",
        description:
          msg === "Failed to fetch" || msg.includes("NetworkError")
            ? "Nelze se spojit se serverem (síť nebo dostupnost API). Zkuste to znovu."
            : msg,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!companyId || !user) return;
    setTesting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Nepřihlášen");
      const url = "/api/company/email-notifications/test";
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] test fetch", url, { companyId });
      }
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId }),
      });
      const responseText = await res.text();
      let json: { ok?: boolean; error?: string } = {};
      try {
        json = responseText ? (JSON.parse(responseText) as { ok?: boolean; error?: string }) : {};
      } catch {
        console.error("[email-notifications-settings] test: bad JSON", res.status, responseText);
        throw new Error(`Neplatná odpověď serveru (${res.status}).`);
      }
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] test response", res.status, json);
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast({
        title: "Test odeslán",
        description: "Zkontrolujte schránku globálních příjemců.",
      });
    } catch (e) {
      console.error("[email-notifications-settings] test failed", e);
      const msg = e instanceof Error ? e.message : "Chyba sítě.";
      toast({
        variant: "destructive",
        title: "Test se nezdařil",
        description:
          msg === "Failed to fetch" || msg.includes("NetworkError")
            ? "Nelze se spojit se serverem. Zkontrolujte připojení."
            : msg,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestModule = async (module: EmailModuleKey) => {
    if (!companyId || !user) return;
    setModuleTesting(module);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Nepřihlášen");
      const url = "/api/company/email-notifications/test-module";
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] test-module fetch", url, { companyId, module });
      }
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId, module }),
      });
      const responseText = await res.text();
      let json: { ok?: boolean; error?: string } = {};
      try {
        json = responseText ? (JSON.parse(responseText) as { ok?: boolean; error?: string }) : {};
      } catch {
        console.error("[email-notifications-settings] test-module: bad JSON", res.status, responseText);
        throw new Error(`Neplatná odpověď serveru (${res.status}).`);
      }
      if (typeof window !== "undefined") {
        console.debug("[email-notifications-settings] test-module response", res.status, json);
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast({
        title: "Test odeslán",
        description: "Zkontrolujte schránku příjemců tohoto modulu.",
      });
    } catch (e) {
      console.error("[email-notifications-settings] test-module failed", e);
      const msg = e instanceof Error ? e.message : "Chyba sítě.";
      toast({
        variant: "destructive",
        title: "Test se nezdařil",
        description:
          msg === "Failed to fetch" || msg.includes("NetworkError")
            ? "Nelze se spojit se serverem. Zkontrolujte připojení."
            : msg,
      });
    } finally {
      setModuleTesting(null);
    }
  };

  if (!companyId) {
    return (
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle>E-mailové notifikace</CardTitle>
          <CardDescription>Načtěte stránku znovu — chybí identifikace organizace.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-surface border-border">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary shrink-0" aria-hidden />
          <CardTitle className="text-xl">E-mailové notifikace</CardTitle>
        </div>
        <CardDescription>
          Nastavte výchozí příjemce a u každého modulu volitelně vlastní okruh lidí a událostí.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-border/80 bg-muted/20 p-4">
          <div className="space-y-1 min-w-0">
            <Label className="text-base">Hlavní přepínač</Label>
            <p className="text-sm text-muted-foreground">
              Zapnutím povolíte odesílání e-mailů podle níže uvedených pravidel.
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(v) => patchDraft((p) => ({ ...p, enabled: v }))}
            className="shrink-0"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Globální příjemci (výchozí)</h3>
          <p className="text-xs text-muted-foreground">
            Tyto adresy a zaměstnanci se použijí u modulů, u kterých je zapnuto „Použít globální
            příjemce“. Administrátoři se přidají vždy, pokud je volba níže zapnutá.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 flex-1">
              <div>
                <Label className="text-sm">Automaticky přidat administrátory organizace</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  E-maily uživatelů s rolí vlastník nebo administrátor (ke každé odeslané notifikaci).
                </p>
              </div>
              <Switch
                checked={draft.includeOrganizationAdmins}
                onCheckedChange={(v) =>
                  patchDraft((p) => ({ ...p, includeOrganizationAdmins: v }))
                }
              />
            </div>
          </div>

          <EmployeeRecipientList
            idPrefix="global-emp"
            employees={employees}
            employeesLoading={employeesLoading}
            lists={globalLists}
            onToggle={toggleGlobalEmployee}
          />

          <div className="space-y-2">
            <Label>Další e-mailové adresy</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                placeholder="např. jednatel@firma.cz"
                value={globalEmailInput}
                onChange={(e) => setGlobalEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGlobalManualEmail();
                  }
                }}
                className="bg-background flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={addGlobalManualEmail}
              >
                Přidat e-mail
              </Button>
            </div>
            <ManualEmailChips emails={draft.globalRecipients} onRemove={removeGlobalManualEmail} />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Moduly a události</h3>
          <p className="text-xs text-muted-foreground">
            Každý modul má vlastní přepínače událostí a volitelně vlastní příjemce.
          </p>

          <Accordion type="multiple" className="w-full border border-border rounded-lg divide-y">
            {MODULE_ORDER.map((moduleKey) => {
              const mod = draft.modules[moduleKey];
              const events = MODULE_EVENT_LABELS[moduleKey];
              const moduleLists: RecipientIdLists = {
                userIds: mod.recipientUserIds,
                employeeIds: mod.recipientEmployeeIds,
              };
              const showOwnRecipients = !mod.useGlobalRecipients;

              return (
                <AccordionItem value={moduleKey} key={moduleKey} className="border-0 px-3">
                  <AccordionTrigger className="text-left hover:no-underline py-3 min-h-[48px]">
                    <span className="font-medium">{MODULE_SECTION_TITLES[moduleKey]}</span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 pt-0 space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                      <Label className="text-sm">E-maily pro tento modul</Label>
                      <Switch
                        checked={mod.enabled}
                        onCheckedChange={(v) => setModuleEnabled(moduleKey, v)}
                      />
                    </div>

                    <div className="space-y-3 rounded-lg border border-border/80 p-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <Label className="text-sm">Použít globální příjemce</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {mod.useGlobalRecipients
                              ? "Použije se výchozí seznam nahoře."
                              : "Použít vlastní příjemce pro tento modul — nastavte níže."}
                          </p>
                        </div>
                        <Switch
                          checked={mod.useGlobalRecipients}
                          onCheckedChange={(v) => setModuleUseGlobalRecipients(moduleKey, v)}
                        />
                      </div>

                      {showOwnRecipients ? (
                        <div className="space-y-4 pt-1 border-t border-dashed border-border/80">
                          <p className="text-sm font-medium">Vlastní příjemci modulu</p>
                          <EmployeeRecipientList
                            idPrefix={`mod-${moduleKey}`}
                            employees={employees}
                            employeesLoading={employeesLoading}
                            lists={moduleLists}
                            onToggle={(emp, c) => toggleModuleEmployee(moduleKey, emp, c)}
                          />
                          <div className="space-y-2">
                            <Label>Další e-mailové adresy</Label>
                            <div className="flex flex-col sm:flex-row gap-2">
                              <Input
                                type="email"
                                placeholder="např. oddeleni@firma.cz"
                                value={moduleEmailInputs[moduleKey] ?? ""}
                                onChange={(e) =>
                                  setModuleEmailInputs((p) => ({
                                    ...p,
                                    [moduleKey]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addModuleManualEmail(moduleKey);
                                  }
                                }}
                                className="bg-background flex-1"
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                className="shrink-0"
                                onClick={() => addModuleManualEmail(moduleKey)}
                              >
                                Přidat e-mail
                              </Button>
                            </div>
                            <ManualEmailChips
                              emails={mod.recipients}
                              onRemove={(em) => removeModuleManualEmail(moduleKey, em)}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <ul className="space-y-3">
                      {events.map(({ eventKey, label }) => (
                        <li
                          key={eventKey}
                          className="flex items-center justify-between gap-3 min-h-[44px]"
                        >
                          <Label htmlFor={`${moduleKey}-${eventKey}`} className="text-sm font-normal">
                            {label}
                          </Label>
                          <Switch
                            id={`${moduleKey}-${eventKey}`}
                            checked={Boolean((mod as Record<string, unknown>)[eventKey])}
                            onCheckedChange={(v) => setModuleEvent(moduleKey, eventKey, v)}
                            disabled={!mod.enabled}
                          />
                        </li>
                      ))}
                    </ul>

                    {moduleKey === "calendar" && mod.enabled ? (
                      <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
                        <p className="text-sm font-medium">Připomenutí před událostí</p>
                        <p className="text-xs text-muted-foreground">
                          Zaškrněte, kolik času předem se má e-mail odeslat (vyžaduje pravidelné
                          volání cronu /api/cron/process-email-queue).
                        </p>
                        <div className="flex flex-col gap-2">
                          {CALENDAR_REMINDER_OFFSET_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-center gap-2 min-h-[40px] cursor-pointer"
                            >
                              <Checkbox
                                checked={draft.modules.calendar.reminderOffsetsMinutes.includes(
                                  opt.value
                                )}
                                onCheckedChange={(v) =>
                                  toggleCalendarOffset(opt.value, v === true)
                                }
                                disabled={!draft.modules.calendar.reminderEnabled}
                              />
                              <span className="text-sm">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <Label className="text-sm">Jen schůzky (bez zaměření)</Label>
                          <Switch
                            checked={draft.modules.calendar.reminderMeetingsOnly}
                            onCheckedChange={(v) =>
                              patchDraft((p) => ({
                                ...p,
                                modules: {
                                  ...p.modules,
                                  calendar: { ...p.modules.calendar, reminderMeetingsOnly: v },
                                },
                              }))
                            }
                            disabled={!draft.modules.calendar.reminderEnabled}
                          />
                        </div>
                      </div>
                    ) : null}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full sm:w-auto"
                      disabled={moduleTesting !== null}
                      onClick={() => void handleTestModule(moduleKey)}
                    >
                      {moduleTesting === moduleKey ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Odesílám…
                        </>
                      ) : (
                        "Odeslat test pro tento modul"
                      )}
                    </Button>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>

        {isDirty ? (
          <p className="text-sm text-amber-700 dark:text-amber-500" role="status">
            Máte neuložené změny.
          </p>
        ) : null}

        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="button"
            className="min-h-[44px] flex-1 sm:flex-none bg-primary text-primary-foreground"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Ukládám…
              </>
            ) : (
              "Uložit nastavení"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] flex-1 sm:flex-none"
            onClick={() => void handleTest()}
            disabled={testing}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Odesílám…
              </>
            ) : (
              "Odeslat testovací e-mail (globální příjemci)"
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Globální test odešle zprávu jen na výchozí seznam a administrátory (podle přepínače). V
          každém modulu můžete otestovat doručení konkrétnímu okruhu.
        </p>
      </CardContent>
    </Card>
  );
}
