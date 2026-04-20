"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { useCollection, useMemoFirebase } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Factory } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseJobProductionSettings, type ProductionCustomerDisplayMode } from "@/lib/job-production-settings";

type EmployeeRow = { id: string; firstName?: string; lastName?: string; email?: string };
type FolderRow = {
  id: string;
  name?: string;
  type?: string;
  productionTeamVisible?: boolean;
};

const CARD = "border-slate-200 bg-white text-slate-900";

export function JobProductionTeamSection(props: {
  firestore: Firestore;
  companyId: string;
  jobId: string;
  job: Record<string, unknown>;
  canManage: boolean;
  user: { uid: string; getIdToken: () => Promise<string> };
}) {
  const { firestore, companyId, jobId, job, canManage, user } = props;
  const { toast } = useToast();
  const settings = useMemo(() => parseJobProductionSettings(job), [job]);

  const empCol = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "employees"),
    [firestore, companyId]
  );
  const { data: employeesRaw } = useCollection(empCol);
  const employees = useMemo(() => {
    const list = Array.isArray(employeesRaw) ? employeesRaw : [];
    return list
      .filter((e): e is EmployeeRow & { id: string } => !!e && typeof (e as { id?: string }).id === "string")
      .map((e) => ({
        id: e.id,
        label: `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.email || e.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "cs"));
  }, [employeesRaw]);

  const foldersCol = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "jobs", jobId, "folders"),
    [firestore, companyId, jobId]
  );
  const { data: foldersRaw } = useCollection(foldersCol);
  const folders = useMemo(() => {
    const list = Array.isArray(foldersRaw) ? foldersRaw : [];
    return list
      .filter((f): f is FolderRow & { id: string } => !!f && typeof (f as { id?: string }).id === "string")
      .filter((f) => f.type !== "documents")
      .map((f) => ({
        id: f.id,
        name: typeof f.name === "string" ? f.name : f.id,
        productionTeamVisible: f.productionTeamVisible === true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "cs"));
  }, [foldersRaw]);

  const [selected, setSelected] = useState<Set<string>>(new Set(settings.productionAssignedEmployeeIds));
  const [displayMode, setDisplayMode] = useState<ProductionCustomerDisplayMode>(
    settings.productionCustomerDisplayMode
  );
  const [internalLabel, setInternalLabel] = useState(settings.productionInternalLabel || "");
  const [statusNote, setStatusNote] = useState(settings.productionStatusNote || "");
  const [teamNotes, setTeamNotes] = useState(
    typeof job.productionTeamNotes === "string" ? job.productionTeamNotes : ""
  );
  const [folderPick, setFolderPick] = useState<Set<string>>(
    new Set(settings.productionVisibleFolderIds || [])
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(new Set(settings.productionAssignedEmployeeIds));
    setDisplayMode(settings.productionCustomerDisplayMode);
    setInternalLabel(settings.productionInternalLabel || "");
    setStatusNote(settings.productionStatusNote || "");
    setFolderPick(new Set(settings.productionVisibleFolderIds || []));
  }, [
    settings.productionAssignedEmployeeIds,
    settings.productionCustomerDisplayMode,
    settings.productionInternalLabel,
    settings.productionStatusNote,
    settings.productionVisibleFolderIds,
  ]);

  useEffect(() => {
    setTeamNotes(typeof job.productionTeamNotes === "string" ? job.productionTeamNotes : "");
  }, [job]);

  const toggleEmp = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolder = (id: string) => {
    setFolderPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const persistFolderProductionFlag = async (folderId: string, visible: boolean) => {
    try {
      await updateDoc(
        doc(firestore, "companies", companyId, "jobs", jobId, "folders", folderId),
        {
          productionTeamVisible: visible,
          updatedAt: serverTimestamp(),
        }
      );
    } catch (e) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Složku se nepodařilo označit",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    }
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/company/production/job-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          jobId,
          productionAssignedEmployeeIds: Array.from(selected),
          productionCustomerDisplayMode: displayMode,
          productionInternalLabel: internalLabel.trim() || null,
          productionVisibleFolderIds: Array.from(folderPick),
          productionStatusNote: statusNote.trim() || null,
          productionTeamNotes: teamNotes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Uložení se nezdařilo.");
      }
      toast({
        title: "Uloženo",
        description: "Nastavení výrobního týmu a viditelnosti bylo aktualizováno.",
      });
    } catch (e: unknown) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return null;

  return (
    <Card className={CARD}>
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
          <Factory className="h-5 w-5 text-primary" />
          Výroba — přiřazení a viditelnost
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4 text-sm text-slate-800">
        <p className="text-xs text-slate-600">
          Vyberte, kdo uvidí zakázku ve výrobě, zda se má zobrazit jméno zákazníka, a které složky s podklady
          jsou pro výrobní tým dostupné. Citlivé obchodní údaje se zaměstnancům v tomto režimu nezobrazují.
        </p>

        <div className="space-y-2">
          <Label>Přiřazení pro realizaci</Label>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-200 p-2 space-y-2">
            {employees.length === 0 ? (
              <p className="text-xs text-slate-500">Žádní zaměstnanci.</p>
            ) : (
              employees.map((e) => (
                <label key={e.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggleEmp(e.id)} />
                  <span>{e.label}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Zobrazení zákazníka ve výrobě</Label>
          <Select
            value={displayMode}
            onValueChange={(v) => setDisplayMode(v as ProductionCustomerDisplayMode)}
          >
            <SelectTrigger className="bg-white border-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              <SelectItem value="show_customer">Zobrazit jméno / označení zákazníka</SelectItem>
              <SelectItem value="internal_only">Pouze interní název zakázky</SelectItem>
            </SelectContent>
          </Select>
          {displayMode === "internal_only" ? (
            <div className="space-y-1">
              <Label className="text-xs">Interní označení pro výrobu</Label>
              <Input
                className="bg-white border-slate-200"
                value={internalLabel}
                onChange={(e) => setInternalLabel(e.target.value)}
                placeholder="např. ZAK-2026-014 / hala A"
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Složky viditelné pro výrobu</Label>
          <p className="text-[11px] text-slate-500">
            Zaškrtněte konkrétní složky, nebo u každé níže zapněte přepínač „Výroba“. Typ „dokumenty“ je z
            bezpečnostních důvodů vyloučen.
          </p>
          <div className="max-h-40 overflow-y-auto rounded border border-slate-200 p-2 space-y-2">
            {folders.length === 0 ? (
              <p className="text-xs text-slate-500">Zatím žádné složky u zakázky.</p>
            ) : (
              folders.map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"
                >
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={folderPick.has(f.id)} onCheckedChange={() => toggleFolder(f.id)} />
                    <span>{f.name}</span>
                  </label>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <Checkbox
                      checked={f.productionTeamVisible}
                      onCheckedChange={(c) => void persistFolderProductionFlag(f.id, c === true)}
                    />
                    Výroba (příznak na složce)
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Stav výroby (krátká zpráva pro tým)</Label>
          <Input
            className="bg-white border-slate-200"
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder="např. Čekáme na profil — řez hotový v úterý"
          />
        </div>

        <div className="space-y-2">
          <Label>Interní výrobní poznámky</Label>
          <Textarea
            className="bg-white border-slate-200 min-h-[80px]"
            value={teamNotes}
            onChange={(e) => setTeamNotes(e.target.value)}
            placeholder="Technické pokyny, upozornění pro montáž…"
          />
        </div>

        <Button type="button" disabled={saving} onClick={() => void saveAll()} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Uložit nastavení výroby
        </Button>
      </CardContent>
    </Card>
  );
}
