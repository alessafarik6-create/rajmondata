"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import type { User } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import { defaultAiLeadValuationSettings } from "@/lib/ai/ai-center-types";
import { AI_SETTINGS_DOC_ID } from "@/lib/ai/ai-settings-types";
import { parseFetchJsonResponse } from "@/lib/api/parse-fetch-response";

type Props = {
  companyId: string;
  firestore: ReturnType<typeof import("@/firebase").useFirestore>;
  user: User | null;
  toast: (p: { title: string; description?: string; variant?: "destructive" }) => void;
};

export function AiLeadValuationTab({ companyId, firestore, user, toast }: Props) {
  const [catalogUrl, setCatalogUrl] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("Montované domy");
  const [importing, setImporting] = useState(false);
  const [testType, setTestType] = useState("Montované domy");
  const [testText, setTestText] = useState("Poptávám montovaný dům 4+KK, 89 m².");
  const [testResult, setTestResult] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState(defaultAiLeadValuationSettings());
  const [savingSettings, setSavingSettings] = useState(false);

  const authFetch = async (path: string, init?: RequestInit) => {
    if (!user) throw new Error("Nepřihlášen");
    const token = await user.getIdToken();
    return fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  };

  const importCatalog = async () => {
    setImporting(true);
    try {
      const res = await authFetch("/api/company/ai/catalog/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: catalogUrl.trim(),
          category: catalogCategory.trim(),
          replaceExistingFromUrl: true,
        }),
      });
      const parsed = await parseFetchJsonResponse<{ ok?: boolean; error?: string; imported?: number }>(
        res
      );
      if (!parsed.ok) throw new Error(parsed.error);
      const data = parsed.data;
      if (!res.ok || !data.ok) {
        throw new Error(String(data.error ?? "Import selhal"));
      }
      toast({
        title: "Ceník importován",
        description: `Uloženo ${data.imported ?? 0} položek.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import ceníku",
        description: e instanceof Error ? e.message : "Selhalo",
      });
    } finally {
      setImporting(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult("");
    try {
      const res = await authFetch("/api/company/ai/lead-valuation/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryType: testType, text: testText }),
      });
      const parsed = await parseFetchJsonResponse<Record<string, unknown>>(res);
      if (!parsed.ok) throw new Error(parsed.error);
      if (!res.ok || parsed.data.ok === false) {
        throw new Error(String(parsed.data.error ?? "Test selhal"));
      }
      setTestResult(JSON.stringify(parsed.data, null, 2));
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Chyba");
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async () => {
    if (!firestore || !user) return;
    setSavingSettings(true);
    try {
      await setDoc(
        doc(firestore, COMPANIES_COLLECTION, companyId, "ai_settings", AI_SETTINGS_DOC_ID),
        {
          companyId,
          leadValuation: settings,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        },
        { merge: true }
      );
      toast({ title: "Nastavení oceňování uloženo" });
    } catch {
      toast({ variant: "destructive", title: "Uložení se nezdařilo" });
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Oceňování poptávek</CardTitle>
          <CardDescription>
            Ceníky a pravidla v CRM — finální částku počítá backend. Pro KOVOKAN importujte ceník z
            veřejné URL (bez natvrdo zabudovaných cen v kódu).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>URL ceníku</Label>
              <Input
                placeholder="https://…"
                value={catalogUrl}
                onChange={(e) => setCatalogUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kategorie produktu</Label>
              <Input value={catalogCategory} onChange={(e) => setCatalogCategory(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                className="w-full min-h-11"
                disabled={importing || !catalogUrl.trim()}
                onClick={() => void importCatalog()}
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Importovat ceník z webu"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pravidla odhadu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["usePriceRules", "Použít cenová pravidla"],
              ["useCatalog", "Použít schválený ceník"],
              ["useHistoricalOffers", "Použít historické nabídky (medián)"],
              ["autoValuateOnImport", "Automaticky ocenit nové poptávky po importu"],
              ["allowRecomputeAiEstimates", "Povolit hromadný přepočet AI odhadů"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <Label className="text-sm font-normal">{label}</Label>
              <Switch
                checked={settings[key]}
                onCheckedChange={(v) => setSettings((s) => ({ ...s, [key]: v }))}
              />
            </div>
          ))}
          <Button type="button" variant="secondary" disabled={savingSettings} onClick={() => void saveSettings()}>
            {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit nastavení"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test ocenění</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Typ poptávky</Label>
            <Input value={testType} onChange={(e) => setTestType(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Text poptávky</Label>
            <Textarea value={testText} onChange={(e) => setTestText(e.target.value)} rows={4} />
          </div>
          <Button type="button" disabled={testing} onClick={() => void runTest()}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spustit test"}
          </Button>
          {testResult ? (
            <pre className="text-xs bg-slate-50 border rounded-md p-3 overflow-x-auto max-h-64">
              {testResult}
            </pre>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
