"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  useEffect(() => {
    void load();
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Ceník</h1>
        <p className="mt-1 text-slate-800">
          Výchozí cena za zaměstnance u docházky a texty pro veřejnou nabídku. Konkrétní moduly upravíte v
          sekci Moduly.
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
                  Použije se u modulu Docházka — celková cena = počet aktivních zaměstnanců × tato částka.
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
    </div>
  );
}
