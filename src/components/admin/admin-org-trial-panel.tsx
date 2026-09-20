"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TrialInfo = {
  subscriptionStatus: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  remainingDays: number;
  trialConsumed: boolean;
  status: string;
  active: boolean;
};

export function AdminOrgTrialPanel({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<TrialInfo | null>(null);
  const [trialEndInput, setTrialEndInput] = useState("");
  const [extendDays, setExtendDays] = useState(7);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(companyId)}/trial`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Načtení selhalo");
      setInfo(data as TrialInfo);
      if (data.trialEndsAt) {
        const d = new Date(data.trialEndsAt);
        if (!Number.isNaN(d.getTime())) {
          setTrialEndInput(d.toISOString().slice(0, 10));
        }
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Trial",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    if (!companyId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/superadmin/companies/${encodeURIComponent(companyId)}/trial`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Uložení selhalo");
      toast({ title: "Licence trial", description: "Změna uložena a zapsána do auditu." });
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení selhalo",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!companyId) return null;

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-sky-200 bg-sky-50/80 p-4 text-sm">
      <p className="font-semibold text-sky-950">Zkušební období</p>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
      ) : info ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-sky-900">
            <dt>Stav licence</dt>
            <dd className="font-medium">{info.subscriptionStatus ?? info.status}</dd>
            <dt>Trial od</dt>
            <dd>{info.trialStartedAt ? new Date(info.trialStartedAt).toLocaleDateString("cs-CZ") : "—"}</dd>
            <dt>Trial do</dt>
            <dd>{info.trialEndsAt ? new Date(info.trialEndsAt).toLocaleDateString("cs-CZ") : "—"}</dd>
            <dt>Zbývá</dt>
            <dd>{info.remainingDays} dní</dd>
          </dl>
          <div className="space-y-2 pt-2">
            <Label htmlFor="trial-end">Datum konce trialu</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="trial-end"
                type="date"
                value={trialEndInput}
                onChange={(e) => setTrialEndInput(e.target.value)}
                className="max-w-[180px]"
              />
              <Button
                type="button"
                size="sm"
                disabled={saving || !trialEndInput}
                onClick={() =>
                  void patch({
                    action: "set_trial_end",
                    trialEndsAt: new Date(trialEndInput + "T23:59:59").toISOString(),
                  })
                }
              >
                Uložit konec
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Prodloužit o (dny)</Label>
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={extendDays}
                  onChange={(e) => setExtendDays(Math.max(1, parseInt(e.target.value, 10) || 7))}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => void patch({ action: "extend_trial", extraDays: extendDays })}
              >
                Prodloužit trial
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => void patch({ action: "end_trial" })}
              >
                Ukončit trial
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => void patch({ action: "convert_to_paid" })}
              >
                Převést na placenou
              </Button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Trial informace nejsou k dispozici.</p>
      )}
    </div>
  );
}
