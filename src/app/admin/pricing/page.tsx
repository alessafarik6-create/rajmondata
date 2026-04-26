"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPricingPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultEmployeePriceCzk, setDefaultEmployeePriceCzk] = useState(49);
  const [promoNote, setPromoNote] = useState("");

  const [loadingPricing, setLoadingPricing] = useState(true);
  const [savingPricing, setSavingPricing] = useState(false);
  const [baseLicenseMonthlyCzk, setBaseLicenseMonthlyCzk] = useState(0);
  const [defaultVatPercent, setDefaultVatPercent] = useState(21);
  const [automationDefaultIntervalDays, setAutomationDefaultIntervalDays] = useState(30);
  const [automationDefaultDueDays, setAutomationDefaultDueDays] = useState(14);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/platform-settings", {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : "Načtení se nezdařilo.",
        });
        return;
      }
      if (typeof data.defaultEmployeePriceCzk === "number") {
        setDefaultEmployeePriceCzk(data.defaultEmployeePriceCzk);
      }
      if (typeof data.promoNote === "string") setPromoNote(data.promoNote);
    } finally {
      setLoading(false);
    }
  };

  const loadPricing = async () => {
    setLoadingPricing(true);
    try {
      const res = await fetch("/api/superadmin/platform-pricing", {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (typeof data.baseLicenseMonthlyCzk === "number") setBaseLicenseMonthlyCzk(data.baseLicenseMonthlyCzk);
      if (typeof data.defaultVatPercent === "number") setDefaultVatPercent(data.defaultVatPercent);
      if (typeof data.automationDefaultIntervalDays === "number") {
        setAutomationDefaultIntervalDays(data.automationDefaultIntervalDays);
      }
      if (typeof data.automationDefaultDueDays === "number") {
        setAutomationDefaultDueDays(data.automationDefaultDueDays);
      }
    } finally {
      setLoadingPricing(false);
    }
  };

  useEffect(() => {
    void load();
    void loadPricing();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          defaultEmployeePriceCzk,
          promoNote,
        }),
      });
      const errJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof errJson?.error === "string" ? errJson.error : "Uložení se nezdařilo.");
      }
      toast({ title: "Sazby uloženy", description: "Nastavení bylo uloženo." });
      await load();
    } catch (e) {
      console.error("[admin pricing save]", e);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const savePricing = async () => {
    setSavingPricing(true);
    try {
      const res = await fetch("/api/superadmin/platform-pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          baseLicenseMonthlyCzk,
          defaultVatPercent,
          automationDefaultIntervalDays,
          automationDefaultDueDays,
        }),
      });
      const errJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof errJson?.error === "string" ? errJson.error : "Uložení se nezdařilo.");
      }
      toast({ title: "Ceník platformy uložen", description: "Dokument platform_settings/pricing." });
      await loadPricing();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba při ukládání ceníku",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSavingPricing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Ceník</h1>
        <p className="mt-1 text-slate-800">
          Výchozí cena za zaměstnance u docházky a texty pro veřejnou nabídku. Konkrétní moduly upravíte v sekci Moduly.
          Fakturační řádek „základní licence“ a výchozí hodnoty automatické fakturace jsou v dokumentu{" "}
          <code className="text-xs bg-slate-100 px-1 rounded">platform_settings/pricing</code>.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Placené tarify</CardTitle>
          <Button type="button" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <>
              <div className="space-y-1">
                <Label>Výchozí cena za zaměstnance (Kč / měsíc)</Label>
                <Input
                  type="number"
                  value={defaultEmployeePriceCzk}
                  onChange={(e) => setDefaultEmployeePriceCzk(Number(e.target.value) || 0)}
                />
                <p className="text-xs text-slate-800">
                  Použije se u modulu Docházka — celková cena = počet aktivních zaměstnanců × tato částka (lze přepsat v
                  katalogu modulu).
                </p>
              </div>
              <div className="space-y-1">
                <Label>Poznámka k cenám (veřejná stránka)</Label>
                <Input value={promoNote} onChange={(e) => setPromoNote(e.target.value)} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Fakturační ceník platformy</CardTitle>
            <CardDescription className="text-slate-700">
              Základní licence (řádek na faktuře z licence), výchozí DPH u automatických položek a výchozí intervaly pro
              novou automatickou fakturaci u organizace.
            </CardDescription>
          </div>
          <Button type="button" onClick={savePricing} disabled={savingPricing || loadingPricing}>
            {savingPricing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit ceník"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 max-w-lg">
          {loadingPricing ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <>
              <div className="space-y-1">
                <Label>Základní licence platformy (Kč / měsíc bez DPH)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={baseLicenseMonthlyCzk}
                  onChange={(e) => setBaseLicenseMonthlyCzk(Number(e.target.value) || 0)}
                />
                <p className="text-xs text-slate-800">0 = řádek se na fakturu z licence nepřidá.</p>
              </div>
              <div className="space-y-1">
                <Label>Výchozí sazba DPH u automatických položek (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={defaultVatPercent}
                  onChange={(e) => setDefaultVatPercent(Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label>Výchozí interval automatické fakturace (dny)</Label>
                <Input
                  type="number"
                  min={1}
                  value={automationDefaultIntervalDays}
                  onChange={(e) => setAutomationDefaultIntervalDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
                />
              </div>
              <div className="space-y-1">
                <Label>Výchozí splatnost od vystavení u automatiky (dny)</Label>
                <Input
                  type="number"
                  min={1}
                  value={automationDefaultDueDays}
                  onChange={(e) => setAutomationDefaultDueDays(Math.max(1, parseInt(e.target.value, 10) || 14))}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
