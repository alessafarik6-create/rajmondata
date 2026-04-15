"use client";

import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
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
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
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
  const [emailInput, setEmailInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setDraft(
      mergeEmailNotifications((company as { emailNotifications?: unknown })?.emailNotifications)
    );
  }, [company]);

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

  const toggleEmployee = (id: string, checked: boolean) => {
    setDraft((prev) => {
      const set = new Set(prev.recipientEmployeeIds);
      if (checked) set.add(id);
      else set.delete(id);
      return { ...prev, recipientEmployeeIds: [...set] };
    });
  };

  const addManualEmail = () => {
    const e = emailInput.trim().toLowerCase();
    if (!e) return;
    if (!isValidEmail(e)) {
      toast({
        variant: "destructive",
        title: "Neplatný e-mail",
        description: "Zadejte adresu ve tvaru jmeno@domena.cz.",
      });
      return;
    }
    setDraft((prev) =>
      prev.recipients.includes(e) ? prev : { ...prev, recipients: [...prev.recipients, e] }
    );
    setEmailInput("");
  };

  const removeManualEmail = (e: string) => {
    setDraft((prev) => ({
      ...prev,
      recipients: prev.recipients.filter((x) => x !== e),
    }));
  };

  const setModuleEnabled = (module: EmailModuleKey, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [module]: { ...prev.modules[module], enabled },
      },
    }));
  };

  const setModuleEvent = (module: EmailModuleKey, eventKey: string, value: boolean) => {
    setDraft((prev) => ({
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

  const toggleCalendarOffset = (minutes: number, checked: boolean) => {
    setDraft((prev) => {
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
    if (!firestore || !companyId) return;
    setSaving(true);
    try {
      const payload = { emailNotifications: draft, updatedAt: serverTimestamp() };
      await Promise.all([
        setDoc(doc(firestore, COMPANIES_COLLECTION, companyId), payload, { merge: true }),
        setDoc(doc(firestore, ORGANIZATIONS_COLLECTION, companyId), payload, { merge: true }),
      ]);
      toast({
        title: "Nastavení bylo uloženo",
        description: "E-mailové notifikace byly aktualizovány.",
      });
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
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
      const res = await fetch("/api/company/email-notifications/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ companyId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok) {
        toast({
          title: "Test odeslán",
          description: "Zkontrolujte schránku nastavených příjemců.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Test se nezdařil",
          description: json.error || "Zkuste to znovu.",
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Test se nezdařil",
        description: e instanceof Error ? e.message : "Chyba sítě.",
      });
    } finally {
      setTesting(false);
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
          Komu budou chodit upozornění a které události mají vyvolat e-mail napříč moduly.
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
            onCheckedChange={(v) => setDraft((p) => ({ ...p, enabled: v }))}
            className="shrink-0"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Komu budou chodit upozornění</h3>
          <p className="text-xs text-muted-foreground">
            Vyberte zaměstnance nebo zadejte e-mailové adresy ručně. Můžete kombinovat obojí.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 flex-1">
              <div>
                <Label className="text-sm">Automaticky přidat administrátory organizace</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  E-maily uživatelů s rolí vlastník nebo administrátor.
                </p>
              </div>
              <Switch
                checked={draft.includeOrganizationAdmins}
                onCheckedChange={(v) =>
                  setDraft((p) => ({ ...p, includeOrganizationAdmins: v }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Zaměstnanci</Label>
            <div
              className={cn(
                "rounded-lg border border-border bg-background",
                employeesLoading && "opacity-70"
              )}
            >
              <ScrollArea className="h-[min(220px,40vh)] p-3">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {employeesLoading ? "Načítání…" : "Žádní zaměstnanci."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {employees.map((emp) => {
                      const label =
                        `${emp.firstName ?? ""} ${emp.lastName ?? ""}`.trim() ||
                        emp.email ||
                        emp.id;
                      const checked = draft.recipientEmployeeIds.includes(emp.id);
                      return (
                        <li key={emp.id} className="flex items-start gap-3 min-h-[44px]">
                          <Checkbox
                            id={`emp-${emp.id}`}
                            checked={checked}
                            onCheckedChange={(v) => toggleEmployee(emp.id, v === true)}
                            className="mt-1"
                          />
                          <label
                            htmlFor={`emp-${emp.id}`}
                            className="flex flex-col cursor-pointer flex-1 min-w-0"
                          >
                            <span className="text-sm font-medium leading-tight">{label}</span>
                            {emp.email ? (
                              <span className="text-xs text-muted-foreground truncate">
                                {emp.email}
                              </span>
                            ) : (
                              <span className="text-xs text-amber-600">
                                Bez e-mailu v profilu — nepoužije se jako příjemce.
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

          <div className="space-y-2">
            <Label>Ruční e-mailové adresy</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="email"
                placeholder="např. jednatel@firma.cz"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManualEmail();
                  }
                }}
                className="bg-background flex-1"
              />
              <Button type="button" variant="secondary" className="shrink-0" onClick={addManualEmail}>
                Přidat adresu
              </Button>
            </div>
            {draft.recipients.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {draft.recipients.map((r) => (
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
                      onClick={() => removeManualEmail(r)}
                      aria-label={`Odebrat ${r}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Moduly a události</h3>
          <p className="text-xs text-muted-foreground">
            Každý modul lze vypnout celý; uvnitř pak jednotlivé typy změn.
          </p>

          <Accordion type="multiple" className="w-full border border-border rounded-lg divide-y">
            {MODULE_ORDER.map((moduleKey) => {
              const mod = draft.modules[moduleKey];
              const events = MODULE_EVENT_LABELS[moduleKey];
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
                              setDraft((p) => ({
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
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>

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
              "Odeslat testovací e-mail"
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Test odešle jednoduchou zprávu na všechny aktuálně vyřešené příjemce (včetně administrátorů,
          pokud je volba zapnutá).
        </p>
      </CardContent>
    </Card>
  );
}
