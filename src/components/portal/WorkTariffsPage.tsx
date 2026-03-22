"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useCollection,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { doc, collection, addDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
type WorkTariffDoc = {
  id: string;
  name: string;
  hourlyRateCzk?: number;
  active?: boolean;
  color?: string;
  category?: string;
  description?: string;
};

export default function WorkTariffsSettingsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { companyId } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile } = useDoc(userRef);

  const privileged =
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.globalRoles?.includes("super_admin");

  const tariffsCol = useMemoFirebase(
    () =>
      firestore && companyId ? collection(firestore, "companies", companyId, "work_tariffs") : null,
    [firestore, companyId]
  );
  const { data: tariffsRaw = [], isLoading } = useCollection<WorkTariffDoc>(tariffsCol);

  const tariffs = useMemo(() => {
    const t = Array.isArray(tariffsRaw) ? [...tariffsRaw] : [];
    t.sort((a, b) => (a.name || "").localeCompare(b.name || "", "cs"));
    return t;
  }, [tariffsRaw]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!firestore || !companyId || !privileged) return;
    const name = newName.trim();
    const rate = Number(newRate.replace(",", "."));
    if (!name) {
      toast({ variant: "destructive", title: "Vyplňte název tarifu." });
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      toast({ variant: "destructive", title: "Zadejte platnou hodinovou sazbu." });
      return;
    }
    setCreating(true);
    try {
      const desc = newDescription.trim();
      await addDoc(collection(firestore, "companies", companyId, "work_tariffs"), {
        companyId,
        name,
        hourlyRateCzk: rate,
        active: true,
        ...(desc ? { description: desc } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log("Tariff created", { name, hourlyRateCzk: rate });
      setNewName("");
      setNewRate("");
      setNewDescription("");
      toast({ title: "Tarif vytvořen" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení se nezdařilo." });
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (row: WorkTariffDoc, next: boolean) => {
    if (!firestore || !companyId || !privileged) return;
    setSavingId(row.id);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "work_tariffs", row.id), {
        active: next,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Aktualizace se nezdařila." });
    } finally {
      setSavingId(null);
    }
  };

  const updateRate = async (row: WorkTariffDoc, value: string) => {
    if (!firestore || !companyId || !privileged) return;
    const rate = Number(value.replace(",", "."));
    if (!Number.isFinite(rate) || rate < 0) {
      toast({ variant: "destructive", title: "Neplatná sazba." });
      return;
    }
    setSavingId(row.id);
    try {
      await updateDoc(doc(firestore, "companies", companyId, "work_tariffs", row.id), {
        hourlyRateCzk: rate,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Sazba uložena" });
    } catch (e) {
      console.error(e);
      toast({ variant: "destructive", title: "Uložení se nezdařilo." });
    } finally {
      setSavingId(null);
    }
  };

  if (!privileged) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-muted-foreground">Tuto stránku vidí jen administrátor.</p>
        <Button asChild variant="link" className="mt-4 px-0">
          <Link href="/portal/settings">Zpět do nastavení</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 pb-16 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-2">
          <Link href="/portal/labor/dochazka">
            <ArrowLeft className="h-4 w-4" />
            Práce a mzdy
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tarify práce</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Interní činnosti (cesta, administrativa, …) s vlastní hodinovou sazbou. Zaměstnanci je
          vybírají v docházce stejně jako zakázky; čas se neodečítá z rozpočtu zakázky.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nový tarif</CardTitle>
          <CardDescription>Název a hodinová sazba v Kč.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="tariff-name">Název</Label>
              <Input
                id="tariff-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Např. Cesta"
              />
            </div>
            <div className="grid w-full gap-2 sm:w-40">
              <Label htmlFor="tariff-rate">Kč / hod</Label>
              <Input
                id="tariff-rate"
                inputMode="decimal"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                placeholder="350"
              />
            </div>
            <Button type="button" className="gap-2" disabled={creating} onClick={() => void handleCreate()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Přidat
            </Button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tariff-desc">Popis (volitelně)</Label>
            <Input
              id="tariff-desc"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Krátký popis tarifu"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seznam tarifů</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tariffs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádné tarify.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {tariffs.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{row.name}</p>
                    {row.description ? (
                      <p className="text-xs text-muted-foreground">{row.description}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {row.active === false ? "Neaktivní" : "Aktivní"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Kč/h</Label>
                      <Input
                        className="h-9 w-28"
                        defaultValue={String(row.hourlyRateCzk ?? "")}
                        key={`${row.id}-${row.hourlyRateCzk}`}
                        disabled={savingId === row.id}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === String(row.hourlyRateCzk ?? "")) return;
                          void updateRate(row, v);
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={row.active !== false}
                        disabled={savingId === row.id}
                        onCheckedChange={(c) => void toggleActive(row, c)}
                      />
                      <span className="text-sm text-muted-foreground">Aktivní</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
