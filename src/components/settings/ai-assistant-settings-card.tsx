"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AI_INQUIRY_TYPE_RULES_COLLECTION,
  AI_SETTINGS_DOC_ID,
  defaultAiAssistantSettings,
  defaultBuiltInInquiryTypeRules,
  type AiAssistantSettingsDoc,
  type AiInquiryTypeRuleDoc,
} from "@/lib/ai/ai-settings-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";

const DEFAULT_AI_MODEL_LABEL = "gpt-4.1-mini";

type Props = { companyId: string };

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function arrayToLines(items: string[]): string {
  return items.join("\n");
}

export function AiAssistantSettingsCard({ companyId }: Props) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const settingsRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, COMPANIES_COLLECTION, companyId, "ai_settings", AI_SETTINGS_DOC_ID)
        : null,
    [firestore, companyId]
  );
  const { data: settingsRaw, isLoading: loadingSettings } = useDoc(settingsRef);

  const rulesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION),
      orderBy("sortOrder", "asc")
    );
  }, [firestore, companyId]);
  const { data: rulesRaw, isLoading: loadingRules } = useCollection(rulesQuery);

  const [enabled, setEnabled] = useState(true);
  const [baseInstructions, setBaseInstructions] = useState("");
  const [useHistoricalQuotes, setUseHistoricalQuotes] = useState(true);
  const [historicalQuotesLimit, setHistoricalQuotesLimit] = useState(8);
  const [preferSentQuotes, setPreferSentQuotes] = useState(true);
  const [preferApprovedAiGenerations, setPreferApprovedAiGenerations] = useState(true);
  const [preferWonJobs, setPreferWonJobs] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<Omit<AiInquiryTypeRuleDoc, "companyId">>({
    name: "",
    matchPatterns: [],
    systemInstructions: "",
    requiredInformation: [],
    optionalInformation: [],
    ignoredInformation: [],
    productCategoryHints: [],
    quoteRules: "",
    active: true,
    sortOrder: 100,
  });
  const [matchPatternsText, setMatchPatternsText] = useState("");
  const [requiredText, setRequiredText] = useState("");
  const [optionalText, setOptionalText] = useState("");
  const [ignoredText, setIgnoredText] = useState("");
  const [categoryHintsText, setCategoryHintsText] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  useEffect(() => {
    const defaults = defaultAiAssistantSettings(companyId);
    const data = settingsRaw as Record<string, unknown> | null | undefined;
    if (!data) {
      setEnabled(defaults.enabled);
      setBaseInstructions(defaults.baseInstructions);
      setUseHistoricalQuotes(defaults.knowledge.useHistoricalQuotes);
      setHistoricalQuotesLimit(defaults.knowledge.historicalQuotesLimit);
      setPreferSentQuotes(defaults.knowledge.preferSentQuotes);
      setPreferApprovedAiGenerations(defaults.knowledge.preferApprovedAiGenerations);
      setPreferWonJobs(defaults.knowledge.preferWonJobs);
      return;
    }
    const k =
      data.knowledge && typeof data.knowledge === "object"
        ? (data.knowledge as Record<string, unknown>)
        : {};
    setEnabled(data.enabled !== false);
    setBaseInstructions(String(data.baseInstructions ?? ""));
    setUseHistoricalQuotes(k.useHistoricalQuotes !== false);
    setHistoricalQuotesLimit(Number(k.historicalQuotesLimit ?? 8) || 8);
    setPreferSentQuotes(k.preferSentQuotes !== false);
    setPreferApprovedAiGenerations(k.preferApprovedAiGenerations !== false);
    setPreferWonJobs(k.preferWonJobs !== false);
  }, [settingsRaw, companyId]);

  const rules = useMemo(() => {
    const list = Array.isArray(rulesRaw) ? rulesRaw : [];
    const parsed = list
      .map((d) => {
        const row = d as Record<string, unknown> & { id?: string };
        const id = String(row.id ?? "").trim();
        if (!id) return null;
        return {
          id,
          companyId,
          name: String(row.name ?? "").trim(),
          matchPatterns: Array.isArray(row.matchPatterns)
            ? row.matchPatterns.map((x) => String(x))
            : [],
          systemInstructions: String(row.systemInstructions ?? ""),
          requiredInformation: Array.isArray(row.requiredInformation)
            ? row.requiredInformation.map((x) => String(x))
            : [],
          optionalInformation: Array.isArray(row.optionalInformation)
            ? row.optionalInformation.map((x) => String(x))
            : [],
          ignoredInformation: Array.isArray(row.ignoredInformation)
            ? row.ignoredInformation.map((x) => String(x))
            : [],
          productCategoryHints: Array.isArray(row.productCategoryHints)
            ? row.productCategoryHints.map((x) => String(x))
            : [],
          quoteRules: String(row.quoteRules ?? ""),
          active: row.active !== false,
          sortOrder: Number(row.sortOrder ?? 100),
        } satisfies AiInquiryTypeRuleDoc;
      })
      .filter(Boolean) as AiInquiryTypeRuleDoc[];

    if (parsed.length > 0) return parsed;
    return defaultBuiltInInquiryTypeRules(companyId).map((r, i) => ({
      ...r,
      id: `builtin-${i}`,
    }));
  }, [rulesRaw, companyId]);

  const hasCustomRules = (Array.isArray(rulesRaw) ? rulesRaw : []).length > 0;

  const saveGeneralSettings = async () => {
    if (!firestore || !companyId || !user) return;
    setSavingSettings(true);
    try {
      await setDoc(
        doc(firestore, COMPANIES_COLLECTION, companyId, "ai_settings", AI_SETTINGS_DOC_ID),
        {
          companyId,
          enabled,
          baseInstructions: baseInstructions.trim(),
          knowledge: {
            useHistoricalQuotes,
            historicalQuotesLimit: Math.min(15, Math.max(1, historicalQuotesLimit)),
            preferSentQuotes,
            preferApprovedAiGenerations,
            preferWonJobs,
          },
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        } satisfies AiAssistantSettingsDoc,
        { merge: true }
      );
      toast({ title: "AI nastavení uloženo" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení se nezdařilo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const seedDefaultRules = async () => {
    if (!firestore || !companyId) return;
    setSavingRule(true);
    try {
      const col = collection(
        firestore,
        COMPANIES_COLLECTION,
        companyId,
        AI_INQUIRY_TYPE_RULES_COLLECTION
      );
      for (const rule of defaultBuiltInInquiryTypeRules(companyId)) {
        await addDoc(col, {
          ...rule,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      toast({ title: "Výchozí pravidla typů poptávek byla vytvořena" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Vytvoření pravidel se nezdařilo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingRule(false);
    }
  };

  const openNewRule = () => {
    setEditingRuleId(null);
    setRuleForm({
      name: "",
      matchPatterns: [],
      systemInstructions: "",
      requiredInformation: [],
      optionalInformation: [],
      ignoredInformation: [],
      productCategoryHints: [],
      quoteRules: "",
      active: true,
      sortOrder: (rules.length + 1) * 10,
    });
    setMatchPatternsText("");
    setRequiredText("");
    setOptionalText("");
    setIgnoredText("");
    setCategoryHintsText("");
    setEditorOpen(true);
  };

  const openEditRule = (rule: AiInquiryTypeRuleDoc) => {
    if (rule.id?.startsWith("builtin-")) {
      toast({
        title: "Vestavěná pravidla",
        description: "Nejdříve vytvořte vlastní pravidla tlačítkem „Vytvořit výchozí pravidla“.",
      });
      return;
    }
    setEditingRuleId(rule.id ?? null);
    setRuleForm({
      name: rule.name,
      matchPatterns: rule.matchPatterns,
      systemInstructions: rule.systemInstructions,
      requiredInformation: rule.requiredInformation,
      optionalInformation: rule.optionalInformation,
      ignoredInformation: rule.ignoredInformation,
      productCategoryHints: rule.productCategoryHints,
      quoteRules: rule.quoteRules,
      active: rule.active,
      sortOrder: rule.sortOrder,
    });
    setMatchPatternsText(arrayToLines(rule.matchPatterns));
    setRequiredText(arrayToLines(rule.requiredInformation));
    setOptionalText(arrayToLines(rule.optionalInformation));
    setIgnoredText(arrayToLines(rule.ignoredInformation));
    setCategoryHintsText(arrayToLines(rule.productCategoryHints));
    setEditorOpen(true);
  };

  const saveRule = async () => {
    if (!firestore || !companyId || !ruleForm.name.trim()) return;
    setSavingRule(true);
    try {
      const payload = {
        companyId,
        name: ruleForm.name.trim(),
        matchPatterns: linesToArray(matchPatternsText),
        systemInstructions: ruleForm.systemInstructions.trim(),
        requiredInformation: linesToArray(requiredText),
        optionalInformation: linesToArray(optionalText),
        ignoredInformation: linesToArray(ignoredText),
        productCategoryHints: linesToArray(categoryHintsText),
        quoteRules: ruleForm.quoteRules.trim(),
        active: ruleForm.active,
        sortOrder: ruleForm.sortOrder,
        updatedAt: serverTimestamp(),
      };
      const col = collection(
        firestore,
        COMPANIES_COLLECTION,
        companyId,
        AI_INQUIRY_TYPE_RULES_COLLECTION
      );
      if (editingRuleId) {
        await updateDoc(
          doc(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION, editingRuleId),
          payload
        );
      } else {
        await addDoc(col, { ...payload, createdAt: serverTimestamp() });
      }
      setEditorOpen(false);
      toast({ title: "Pravidlo typu poptávky uloženo" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení pravidla se nezdařilo",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!firestore || !companyId || ruleId.startsWith("builtin-")) return;
    if (!window.confirm("Smazat toto pravidlo typu poptávky?")) return;
    try {
      await deleteDoc(
        doc(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION, ruleId)
      );
      toast({ title: "Pravidlo smazáno" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Smazání se nezdařilo",
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const modelLabel = DEFAULT_AI_MODEL_LABEL;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-violet-600" />
          AI asistent — nabídky k poptávkám
        </CardTitle>
        <CardDescription>
          Pravidla podle typu poptávky, historické nabídky jako inspirace a zpětná vazba z
          úprav. Model serveru: <span className="font-medium">{modelLabel}</span> (env{" "}
          <code className="text-xs">OPENAI_MODEL</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {loadingSettings ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Načítání nastavení…
          </div>
        ) : (
          <>
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Obecné</h3>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <Label htmlFor="ai-enabled">AI asistent aktivní</Label>
                  <p className="text-xs text-muted-foreground">
                    Vypne generování návrhů v portálu (nezávisle na env přepínači).
                  </p>
                </div>
                <Switch id="ai-enabled" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-base-instructions">Základní instrukce pro AI</Label>
                <Textarea
                  id="ai-base-instructions"
                  rows={4}
                  value={baseInstructions}
                  onChange={(e) => setBaseInstructions(e.target.value)}
                  placeholder="Doplňující firemní pravidla pro všechny typy poptávek…"
                />
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Zdroje znalostí</h3>
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label>Používat historické nabídky</Label>
                  <Switch
                    checked={useHistoricalQuotes}
                    onCheckedChange={setUseHistoricalQuotes}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label>Preferovat odeslané nabídky</Label>
                  <Switch checked={preferSentQuotes} onCheckedChange={setPreferSentQuotes} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label>Preferovat schválené AI návrhy</Label>
                  <Switch
                    checked={preferApprovedAiGenerations}
                    onCheckedChange={setPreferApprovedAiGenerations}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <Label>Preferovat získané zakázky (připraveno)</Label>
                  <Switch checked={preferWonJobs} onCheckedChange={setPreferWonJobs} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-quotes-limit">Počet podobných nabídek v kontextu</Label>
                  <Input
                    id="ai-quotes-limit"
                    type="number"
                    min={1}
                    max={15}
                    value={historicalQuotesLimit}
                    onChange={(e) =>
                      setHistoricalQuotesLimit(Number(e.target.value) || 8)
                    }
                    className="max-w-[120px]"
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={() => void saveGeneralSettings()}
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Uložit obecné nastavení
              </Button>
            </section>
          </>
        )}

        <section className="space-y-4 border-t pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Typy poptávek</h3>
            <div className="flex flex-wrap gap-2">
              {!hasCustomRules ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={savingRule}
                  onClick={() => void seedDefaultRules()}
                >
                  Vytvořit výchozí pravidla
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={openNewRule}>
                <Plus className="mr-1 h-4 w-4" />
                Nový typ
              </Button>
            </div>
          </div>
          {!hasCustomRules ? (
            <p className="text-xs text-muted-foreground">
              Zatím používáte vestavěná pravidla (Pergoly svépomocí, Zimní zahrada, Obecná
              poptávka). Pro úpravu v administraci vytvořte výchozí pravidla ve Firestore.
            </p>
          ) : null}
          {loadingRules ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Vzory: {rule.matchPatterns.join(", ") || "—"}
                    </p>
                    {rule.ignoredInformation.length > 0 ? (
                      <p className="mt-1 text-xs text-amber-800">
                        Neptat se na: {rule.ignoredInformation.slice(0, 4).join("; ")}
                        {rule.ignoredInformation.length > 4 ? "…" : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditRule(rule)}
                      aria-label={`Upravit ${rule.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {rule.id && !rule.id.startsWith("builtin-") ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void deleteRule(rule.id!)}
                        aria-label={`Smazat ${rule.name}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Ceny produktů spravujte v{" "}
            <a href="/portal/catalogs" className="underline">
              Produktovém katalogu
            </a>
            . AI nikdy nevymýšlí ceny — používá ceník CRM.
          </p>
        </section>
      </CardContent>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRuleId ? "Upravit typ poptávky" : "Nový typ poptávky"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Název</Label>
              <Input
                value={ruleForm.name}
                onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Vzory pro párování (1 řádek = 1 vzor)</Label>
              <Textarea
                rows={2}
                value={matchPatternsText}
                onChange={(e) => setMatchPatternsText(e.target.value)}
                placeholder={"pergol\nsvépomoc"}
              />
            </div>
            <div className="space-y-2">
              <Label>Instrukce pro AI</Label>
              <Textarea
                rows={3}
                value={ruleForm.systemInstructions}
                onChange={(e) =>
                  setRuleForm((f) => ({ ...f, systemInstructions: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Povinné informace (řádky)</Label>
              <Textarea rows={2} value={requiredText} onChange={(e) => setRequiredText(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Volitelné informace</Label>
              <Textarea rows={2} value={optionalText} onChange={(e) => setOptionalText(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Informace, které se NESMÍ požadovat</Label>
              <Textarea
                rows={2}
                value={ignoredText}
                onChange={(e) => setIgnoredText(e.target.value)}
                placeholder={"boční zasklení\ntyp skla"}
              />
            </div>
            <div className="space-y-2">
              <Label>Relevantní kategorie produktů (filtr katalogu)</Label>
              <Textarea
                rows={2}
                value={categoryHintsText}
                onChange={(e) => setCategoryHintsText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Pravidla tvorby nabídky</Label>
              <Textarea
                rows={2}
                value={ruleForm.quoteRules}
                onChange={(e) => setRuleForm((f) => ({ ...f, quoteRules: e.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Aktivní</Label>
              <Switch
                checked={ruleForm.active}
                onCheckedChange={(v) => setRuleForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
              Zrušit
            </Button>
            <Button type="button" disabled={savingRule} onClick={() => void saveRule()}>
              {savingRule ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
