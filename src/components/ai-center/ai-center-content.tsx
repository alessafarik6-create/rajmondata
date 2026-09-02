"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  limit,
} from "firebase/firestore";
import { useFirestore, useDoc, useCollection, useMemoFirebase, useUser, useCompany } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, Sparkles, Upload, ExternalLink } from "lucide-react";
import {
  AI_INQUIRY_TYPE_RULES_COLLECTION,
  AI_SETTINGS_DOC_ID,
  defaultAiAssistantSettings,
  defaultBuiltInInquiryTypeRules,
  type AiAssistantSettingsDoc,
  type AiInquiryTypeRuleDoc,
} from "@/lib/ai/ai-settings-types";
import {
  AI_KNOWLEDGE_DOCUMENTS_COLLECTION,
  AI_PRICE_RULES_COLLECTION,
  AI_QUOTE_EXAMPLES_COLLECTION,
  AI_KNOWLEDGE_CATEGORY_LABELS,
  AI_PRICE_CALCULATION_LABELS,
  defaultAiInstructionCategories,
  type AiKnowledgeCategory,
  type AiKnowledgeDocumentDoc,
  type AiPriceCalculationType,
  type AiPriceRuleDoc,
  type AiQuoteExampleDoc,
} from "@/lib/ai/ai-center-types";
import { COMPANIES_COLLECTION } from "@/lib/firestore-collections";
import type { AiValidatedQuoteResult } from "@/lib/ai/types";

const DEFAULT_AI_MODEL_LABEL = "gpt-4.1-mini";

type Props = { companyId: string };

function linesToArray(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function arrayToLines(items: string[]): string {
  return items.join("\n");
}

export function AiCenterContent({ companyId }: Props) {
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            AI centrum
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Správa cenových pravidel, znalostní báze a chování AI asistenta. Ceny vždy počítá backend z CRM pravidel.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/portal/settings">Nastavení organizace</Link>
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Přehled</TabsTrigger>
          <TabsTrigger value="price-rules">Cenová pravidla</TabsTrigger>
          <TabsTrigger value="inquiry-types">Typy poptávek</TabsTrigger>
          <TabsTrigger value="knowledge">Znalostní báze</TabsTrigger>
          <TabsTrigger value="examples">Příklady nabídek</TabsTrigger>
          <TabsTrigger value="instructions">Instrukce AI</TabsTrigger>
          <TabsTrigger value="test">Test AI</TabsTrigger>
          <TabsTrigger value="history">Historie / feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab companyId={companyId} user={user} />
        </TabsContent>
        <TabsContent value="price-rules">
          <PriceRulesTab companyId={companyId} firestore={firestore} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="inquiry-types">
          <InquiryTypesTab companyId={companyId} firestore={firestore} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="knowledge">
          <KnowledgeTab companyId={companyId} firestore={firestore} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="examples">
          <ExamplesTab companyId={companyId} firestore={firestore} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="instructions">
          <InstructionsTab companyId={companyId} firestore={firestore} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="test">
          <TestAiTab companyId={companyId} user={user} toast={toast} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab companyId={companyId} firestore={firestore} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({
  companyId,
  user,
}: {
  companyId: string;
  user: ReturnType<typeof useUser>["user"];
}) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    activePriceRules: number;
    knowledgeDocuments: number;
    quoteExamples: number;
    lastGenerationAt: string | null;
    avgConfidence: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || !companyId) return;
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/company/ai/stats?companyId=${encodeURIComponent(companyId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { ok?: boolean; stats?: typeof stats };
        if (!cancelled && data.ok && data.stats) setStats(data.stats);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, companyId]);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[
        { label: "Aktivní cenová pravidla", value: stats?.activePriceRules ?? "—" },
        { label: "Znalostní dokumenty", value: stats?.knowledgeDocuments ?? "—" },
        { label: "AI vzory nabídek", value: stats?.quoteExamples ?? "—" },
        {
          label: "Průměrná confidence",
          value:
            stats?.avgConfidence != null
              ? `${Math.round(stats.avgConfidence * 100)} %`
              : "—",
        },
      ].map((item) => (
        <Card key={item.label}>
          <CardHeader className="pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-3xl">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : item.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
      <Card className="md:col-span-2 lg:col-span-4">
        <CardHeader>
          <CardTitle className="text-base">Poslední AI generování</CardTitle>
          <CardDescription>
            {loading
              ? "Načítání…"
              : stats?.lastGenerationAt
                ? new Date(stats.lastGenerationAt).toLocaleString("cs-CZ")
                : "Zatím žádné generování"}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Priorita zdrojů: 1) cenová pravidla CRM → 2) pravidla typu poptávky → 3) katalog → 4) znalostní báze → 5) historické nabídky.</p>
          <p>Model: {DEFAULT_AI_MODEL_LABEL} (konfigurace serveru OPENAI_MODEL).</p>
        </CardContent>
      </Card>
    </div>
  );
}

function PriceRulesTab({
  companyId,
  firestore,
  user,
  toast,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const rulesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, COMPANIES_COLLECTION, companyId, AI_PRICE_RULES_COLLECTION);
  }, [firestore, companyId]);
  const { data: rulesRaw, isLoading } = useCollection(rulesQuery);
  const rules = useMemo(
    () =>
      ([...(rulesRaw ?? [])] as AiPriceRuleDoc[]).sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
      ),
    [rulesRaw]
  );

  const catalogsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, COMPANIES_COLLECTION, companyId, "product_catalogs");
  }, [firestore, companyId]);
  const { data: catalogsRaw } = useCollection(catalogsQuery);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiPriceRuleDoc | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = (): AiPriceRuleDoc => ({
    companyId,
    name: "",
    inquiryType: "",
    productCategory: "",
    calculationType: "per_m2",
    value: 0,
    currency: "CZK",
    catalogId: "",
    productId: "",
    productNamePattern: "",
    validFrom: "",
    validTo: "",
    priority: 10,
    active: true,
    description: "",
  });

  const [form, setForm] = useState<AiPriceRuleDoc>(emptyForm());

  const catalogProducts = useMemo(() => {
    const out: Array<{ catalogId: string; catalogName: string; productId: string; name: string }> = [];
    for (const cat of catalogsRaw ?? []) {
      const c = cat as Record<string, unknown> & { id: string };
      const list = Array.isArray(c.products) ? c.products : [];
      for (const p of list) {
        if (!p || typeof p !== "object") continue;
        const pr = p as Record<string, unknown>;
        const productId = String(pr.id ?? "").trim();
        const name = String(pr.name ?? "").trim();
        if (productId && name) {
          out.push({
            catalogId: c.id,
            catalogName: String(c.name ?? c.id),
            productId,
            name,
          });
        }
      }
    }
    return out;
  }, [catalogsRaw]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (rule: AiPriceRuleDoc) => {
    setEditing(rule);
    setForm({ ...rule });
    setDialogOpen(true);
  };

  const saveRule = async () => {
    if (!firestore || !user || !form.name.trim()) {
      toast({ title: "Vyplňte název pravidla.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        companyId,
        name: form.name.trim(),
        inquiryType: form.inquiryType?.trim() || null,
        productCategory: form.productCategory?.trim() || null,
        calculationType: form.calculationType,
        value: Number(form.value) || 0,
        currency: form.currency || "CZK",
        catalogId: form.catalogId?.trim() || null,
        productId: form.productId?.trim() || null,
        productNamePattern: form.productNamePattern?.trim() || null,
        validFrom: form.validFrom?.trim() || null,
        validTo: form.validTo?.trim() || null,
        priority: Number(form.priority) || 0,
        active: form.active !== false,
        description: form.description?.trim() || null,
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
      };

      if (editing?.id) {
        await updateDoc(
          doc(firestore, COMPANIES_COLLECTION, companyId, AI_PRICE_RULES_COLLECTION, editing.id),
          payload
        );
      } else {
        await addDoc(collection(firestore, COMPANIES_COLLECTION, companyId, AI_PRICE_RULES_COLLECTION), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      toast({ title: "Cenové pravidlo uloženo." });
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: "Uložení se nezdařilo.",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (rule: AiPriceRuleDoc) => {
    if (!firestore || !rule.id || !confirm(`Smazat pravidlo „${rule.name}"?`)) return;
    await deleteDoc(doc(firestore, COMPANIES_COLLECTION, companyId, AI_PRICE_RULES_COLLECTION, rule.id));
    toast({ title: "Pravidlo smazáno." });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Cenová pravidla</CardTitle>
          <CardDescription>
            Autoritativní ceny pro backend. Propojte pravidlo s produktem v katalogu nebo použijte vzor názvu.
          </CardDescription>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Přidat
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Zatím žádná pravidla. Přidejte např. pergola základ 4 500 Kč/m² nebo příplatek polykarbonát.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border rounded-lg p-3"
              >
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {AI_PRICE_CALCULATION_LABELS[r.calculationType as AiPriceCalculationType] ?? r.calculationType}{" "}
                    · {r.value} {r.currency}
                    {r.inquiryType ? ` · ${r.inquiryType}` : ""}
                    {r.active === false ? " · neaktivní" : ""}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void deleteRule(r)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Upravit pravidlo" : "Nové cenové pravidlo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Název</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Typ výpočtu</Label>
                <Select
                  value={form.calculationType}
                  onValueChange={(v) => setForm({ ...form, calculationType: v as AiPriceCalculationType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(AI_PRICE_CALCULATION_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Hodnota</Label>
                  <Input
                    type="number"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>Priorita</Label>
                  <Input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label>Typ poptávky (volitelné)</Label>
                <Input
                  value={form.inquiryType ?? ""}
                  onChange={(e) => setForm({ ...form, inquiryType: e.target.value })}
                  placeholder="Pergoly svépomocí"
                />
              </div>
              <div>
                <Label>Vzor názvu produktu (volitelné)</Label>
                <Input
                  value={form.productNamePattern ?? ""}
                  onChange={(e) => setForm({ ...form, productNamePattern: e.target.value })}
                  placeholder="polykarbonát"
                />
              </div>
              <div>
                <Label>Propojit s produktem v katalogu</Label>
                <Select
                  value={
                    form.catalogId && form.productId
                      ? `${form.catalogId}::${form.productId}`
                      : "__none__"
                  }
                  onValueChange={(v) => {
                    if (v === "__none__") {
                      setForm({ ...form, catalogId: "", productId: "" });
                      return;
                    }
                    const [catalogId, productId] = v.split("::");
                    setForm({ ...form, catalogId, productId });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="— bez propojení —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— bez propojení —</SelectItem>
                    {catalogProducts.map((p) => (
                      <SelectItem key={`${p.catalogId}::${p.productId}`} value={`${p.catalogId}::${p.productId}`}>
                        {p.catalogName} / {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active !== false} onCheckedChange={(c) => setForm({ ...form, active: c })} />
                <Label>Aktivní</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Zrušit</Button>
              <Button onClick={() => void saveRule()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function InquiryTypesTab({
  companyId,
  firestore,
  user,
  toast,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const rulesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION),
      orderBy("sortOrder", "asc")
    );
  }, [firestore, companyId]);
  const { data: rulesRaw, isLoading } = useCollection(rulesQuery);
  const rules = (rulesRaw ?? []) as AiInquiryTypeRuleDoc[];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiInquiryTypeRuleDoc | null>(null);
  const [form, setForm] = useState<AiInquiryTypeRuleDoc>(defaultBuiltInInquiryTypeRules(companyId)[0]);
  const [saving, setSaving] = useState(false);

  const seedDefaults = async () => {
    if (!firestore || !user) return;
    for (const rule of defaultBuiltInInquiryTypeRules(companyId)) {
      await addDoc(collection(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION), {
        ...rule,
        updatedAt: serverTimestamp(),
      });
    }
    toast({ title: "Výchozí typy poptávek vytvořeny." });
  };

  const saveRule = async () => {
    if (!firestore || !user || !form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        companyId,
        matchPatterns: form.matchPatterns?.length ? form.matchPatterns : linesToArray(String((form as any).matchPatternsText ?? "")),
        requiredInformation: linesToArray(String((form as any).requiredText ?? arrayToLines(form.requiredInformation))),
        optionalInformation: linesToArray(String((form as any).optionalText ?? arrayToLines(form.optionalInformation))),
        ignoredInformation: linesToArray(String((form as any).ignoredText ?? arrayToLines(form.ignoredInformation))),
        productCategoryHints: linesToArray(String((form as any).hintsText ?? arrayToLines(form.productCategoryHints))),
        updatedAt: serverTimestamp(),
      };
      if (editing?.id) {
        await updateDoc(
          doc(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION, editing.id),
          payload
        );
      } else {
        await addDoc(collection(firestore, COMPANIES_COLLECTION, companyId, AI_INQUIRY_TYPE_RULES_COLLECTION), payload);
      }
      toast({ title: "Typ poptávky uložen." });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row justify-between">
        <div>
          <CardTitle>Typy poptávek</CardTitle>
          <CardDescription>Povinné, volitelné a ignorované údaje podle typu poptávky.</CardDescription>
        </div>
        <div className="flex gap-2">
          {rules.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => void seedDefaults()}>
              Načíst výchozí
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setForm({ ...defaultBuiltInInquiryTypeRules(companyId)[0], companyId, name: "" });
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Přidat
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          rules.map((r) => (
            <div key={r.id} className="border rounded-lg p-3 flex justify-between gap-2">
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  Ignorované: {r.ignoredInformation?.slice(0, 3).join(", ") || "—"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setEditing(r);
                  setForm({
                    ...r,
                    ...( {
                      requiredText: arrayToLines(r.requiredInformation ?? []),
                      optionalText: arrayToLines(r.optionalInformation ?? []),
                      ignoredText: arrayToLines(r.ignoredInformation ?? []),
                      hintsText: arrayToLines(r.productCategoryHints ?? []),
                      matchPatternsText: arrayToLines(r.matchPatterns ?? []),
                    } as any),
                  });
                  setDialogOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing ? "Upravit typ" : "Nový typ poptávky"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Název</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Shody (řádky)</Label><Textarea rows={2} defaultValue={arrayToLines(form.matchPatterns ?? [])} onChange={(e) => ((form as any).matchPatternsText = e.target.value)} /></div>
              <div><Label>Povinné údaje</Label><Textarea rows={3} defaultValue={arrayToLines(form.requiredInformation ?? [])} onChange={(e) => ((form as any).requiredText = e.target.value)} /></div>
              <div><Label>Volitelné údaje</Label><Textarea rows={2} defaultValue={arrayToLines(form.optionalInformation ?? [])} onChange={(e) => ((form as any).optionalText = e.target.value)} /></div>
              <div><Label>Ignorované údaje</Label><Textarea rows={2} defaultValue={arrayToLines(form.ignoredInformation ?? [])} onChange={(e) => ((form as any).ignoredText = e.target.value)} /></div>
              <div><Label>Instrukce pro AI</Label><Textarea rows={3} value={form.systemInstructions} onChange={(e) => setForm({ ...form, systemInstructions: e.target.value })} /></div>
              <div><Label>Pravidla nabídky</Label><Textarea rows={2} value={form.quoteRules} onChange={(e) => setForm({ ...form, quoteRules: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => void saveRule()} disabled={saving}>Uložit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function KnowledgeTab({
  companyId,
  firestore,
  user,
  toast,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const docsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, COMPANIES_COLLECTION, companyId, AI_KNOWLEDGE_DOCUMENTS_COLLECTION);
  }, [firestore, companyId]);
  const { data: docsRaw, isLoading } = useCollection(docsQuery);
  const docs = useMemo(() => [...(docsRaw ?? [])] as AiKnowledgeDocumentDoc[], [docsRaw]);

  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<AiKnowledgeCategory>("general");
  const [file, setFile] = useState<File | null>(null);

  const upload = async () => {
    if (!user || !file) {
      toast({ title: "Vyberte soubor.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("companyId", companyId);
      fd.append("title", title || file.name);
      fd.append("category", category);
      fd.append("file", file);
      const res = await fetch("/api/company/ai/knowledge/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; chunkCount?: number };
      if (!data.ok) throw new Error(data.error ?? "Upload selhal");
      toast({ title: `Dokument zpracován (${data.chunkCount ?? 0} segmentů).` });
      setFile(null);
      setTitle("");
    } catch (e) {
      toast({
        title: "Nahrání se nezdařilo.",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const toggleActive = async (docItem: AiKnowledgeDocumentDoc) => {
    if (!firestore || !docItem.id) return;
    await updateDoc(
      doc(firestore, COMPANIES_COLLECTION, companyId, AI_KNOWLEDGE_DOCUMENTS_COLLECTION, docItem.id),
      { active: docItem.active === false, updatedAt: serverTimestamp() }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Znalostní báze</CardTitle>
        <CardDescription>PDF, TXT — text se rozdělí, vytvoří embeddings a použije při generování nabídek.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 border rounded-lg p-4">
          <div><Label>Název</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ceník pergol 2026" /></div>
          <div>
            <Label>Kategorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as AiKnowledgeCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(AI_KNOWLEDGE_CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Soubor</Label>
            <Input type="file" accept=".pdf,.txt,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button onClick={() => void upload()} disabled={uploading || !file}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
            Nahrát a zpracovat
          </Button>
        </div>

        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádné dokumenty.</p>
        ) : (
          docs.map((d) => (
            <div key={d.id} className="flex justify-between items-center border rounded-lg p-3 text-sm">
              <div>
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {AI_KNOWLEDGE_CATEGORY_LABELS[d.category]} · {d.status} · {d.chunkCount ?? 0} segmentů
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={d.active !== false} onCheckedChange={() => void toggleActive(d)} />
                {d.downloadUrl ? (
                  <a href={d.downloadUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ExamplesTab({
  companyId,
  firestore,
  user,
  toast,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const examplesQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return collection(firestore, COMPANIES_COLLECTION, companyId, AI_QUOTE_EXAMPLES_COLLECTION);
  }, [firestore, companyId]);
  const { data: examplesRaw } = useCollection(examplesQuery);

  const offersQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(collection(firestore, COMPANIES_COLLECTION, companyId, "inquiry_offers"), limit(80));
  }, [firestore, companyId]);
  const { data: offersRaw } = useCollection(offersQuery);

  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<Partial<AiQuoteExampleDoc>>({
    inquiryType: "",
    title: "",
    dimensionsText: "",
    bodyText: "",
    itemsSummary: "",
    referencePriceNet: null,
    active: true,
    source: "manual",
  });

  const saveManual = async () => {
    if (!firestore || !user || !manual.title?.trim()) return;
    await addDoc(collection(firestore, COMPANIES_COLLECTION, companyId, AI_QUOTE_EXAMPLES_COLLECTION), {
      companyId,
      source: "manual",
      inquiryType: manual.inquiryType?.trim() || "Obecná poptávka",
      title: manual.title.trim(),
      dimensionsText: manual.dimensionsText?.trim() || null,
      bodyText: manual.bodyText?.trim() || null,
      itemsSummary: manual.itemsSummary?.trim() || null,
      referencePriceNet: manual.referencePriceNet ?? null,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
    });
    toast({ title: "Příklad uložen." });
    setManualOpen(false);
  };

  const toggleOfferExample = async (offerId: string, current: boolean) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/offers/set-example", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, offerId, useForAiExample: !current }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Uložení selhalo");
      toast({ title: !current ? "Nabídka označena jako AI vzor." : "AI vzor odebrán." });
    } catch (e) {
      toast({
        title: "Nepodařilo se uložit.",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row justify-between">
          <div>
            <CardTitle>Příklady nabídek</CardTitle>
            <CardDescription>Historické ceny nejsou autoritativní — slouží jako vzor struktury a textu.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setManualOpen(true)}><Plus className="h-4 w-4 mr-1" /> Ruční příklad</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="text-sm font-medium mb-2">Existující nabídky v CRM</h3>
            {(offersRaw ?? []).slice(0, 30).map((o) => {
              const offer = o as Record<string, unknown> & { id: string };
              const subject = String(offer.subject ?? offer.id);
              const useForAi = offer.useForAiExample === true;
              return (
                <div key={offer.id} className="flex justify-between items-center border rounded p-2 mb-1 text-sm">
                  <span>{subject}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Používat pro AI</span>
                    <Switch checked={useForAi} onCheckedChange={() => void toggleOfferExample(offer.id, useForAi)} />
                  </div>
                </div>
              );
            })}
          </div>
          {(examplesRaw ?? []).length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Ruční příklady</h3>
              {(examplesRaw ?? []).map((ex) => {
                const e = ex as AiQuoteExampleDoc;
                return (
                  <div key={e.id} className="border rounded p-2 mb-1 text-sm">
                    <p className="font-medium">{e.title}</p>
                    <p className="text-xs text-muted-foreground">{e.inquiryType}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ruční příklad nabídky</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Typ poptávky</Label><Input value={manual.inquiryType ?? ""} onChange={(e) => setManual({ ...manual, inquiryType: e.target.value })} /></div>
            <div><Label>Název</Label><Input value={manual.title ?? ""} onChange={(e) => setManual({ ...manual, title: e.target.value })} /></div>
            <div><Label>Rozměr</Label><Input value={manual.dimensionsText ?? ""} onChange={(e) => setManual({ ...manual, dimensionsText: e.target.value })} placeholder="5000 × 3000 mm" /></div>
            <div><Label>Text nabídky</Label><Textarea rows={4} value={manual.bodyText ?? ""} onChange={(e) => setManual({ ...manual, bodyText: e.target.value })} /></div>
            <div><Label>Položky</Label><Textarea rows={2} value={manual.itemsSummary ?? ""} onChange={(e) => setManual({ ...manual, itemsSummary: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={() => void saveManual()}>Uložit</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InstructionsTab({
  companyId,
  firestore,
  user,
  toast,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const settingsRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? doc(firestore, COMPANIES_COLLECTION, companyId, "ai_settings", AI_SETTINGS_DOC_ID)
        : null,
    [firestore, companyId]
  );
  const { data: settingsRaw, isLoading } = useDoc(settingsRef);
  const settings = (settingsRaw ?? defaultAiAssistantSettings(companyId)) as AiAssistantSettingsDoc;

  const [enabled, setEnabled] = useState(true);
  const [baseInstructions, setBaseInstructions] = useState("");
  const [quotes, setQuotes] = useState("");
  const [documents, setDocuments] = useState("");
  const [communication, setCommunication] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settingsRaw) return;
    const s = settingsRaw as AiAssistantSettingsDoc;
    setEnabled(s.enabled !== false);
    setBaseInstructions(s.baseInstructions ?? "");
    const cats = s.instructionCategories ?? defaultAiInstructionCategories();
    setQuotes(cats.quotes ?? "");
    setDocuments(cats.documents ?? "");
    setCommunication(cats.communication ?? "");
  }, [settingsRaw]);

  const save = async () => {
    if (!firestore || !user || !settingsRef) return;
    setSaving(true);
    try {
      await setDoc(
        settingsRef,
        {
          companyId,
          enabled,
          baseInstructions: baseInstructions.trim(),
          instructionCategories: { quotes: quotes.trim(), documents: documents.trim(), communication: communication.trim() },
          knowledge: settings.knowledge ?? defaultAiAssistantSettings(companyId).knowledge,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        },
        { merge: true }
      );
      toast({ title: "Instrukce uloženy." });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instrukce AI</CardTitle>
        <CardDescription>Globální firemní instrukce — pouze admin/owner.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label>AI asistent zapnutý</Label>
        </div>
        <div><Label>Globální instrukce</Label><Textarea rows={4} value={baseInstructions} onChange={(e) => setBaseInstructions(e.target.value)} /></div>
        <div><Label>Instrukce pro nabídky</Label><Textarea rows={3} value={quotes} onChange={(e) => setQuotes(e.target.value)} /></div>
        <div><Label>Instrukce pro dokumenty</Label><Textarea rows={2} value={documents} onChange={(e) => setDocuments(e.target.value)} /></div>
        <div><Label>Instrukce pro komunikaci</Label><Textarea rows={2} value={communication} onChange={(e) => setCommunication(e.target.value)} /></div>
        <Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}</Button>
      </CardContent>
    </Card>
  );
}

function TestAiTab({
  companyId,
  user,
  toast,
}: {
  companyId: string;
  user: ReturnType<typeof useUser>["user"];
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [inquiryType, setInquiryType] = useState("Pergoly svépomocí");
  const [inquiryText, setInquiryText] = useState("Pergola 5 x 3 m, polykarbonát 16 mm");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiValidatedQuoteResult | null>(null);
  const [contextSummary, setContextSummary] = useState<Record<string, unknown> | null>(null);

  const runTest = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setResult(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/ai/test-quote", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, inquiryType, inquiryText }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        result?: AiValidatedQuoteResult;
        contextSummary?: Record<string, unknown>;
      };
      if (!data.ok) throw new Error(data.error ?? "Test selhal");
      setResult(data.result ?? null);
      setContextSummary(data.contextSummary ?? null);
    } catch (e) {
      toast({
        title: "Test AI selhal",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, companyId, inquiryType, inquiryText, toast]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Test AI</CardTitle><CardDescription>Simulace poptávky bez uložení do CRM.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Typ poptávky</Label><Input value={inquiryType} onChange={(e) => setInquiryType(e.target.value)} /></div>
          <div><Label>Text poptávky</Label><Textarea rows={3} value={inquiryText} onChange={(e) => setInquiryText(e.target.value)} /></div>
          <Button onClick={() => void runTest()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Vygenerovat test
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader><CardTitle>Výsledek</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p><strong>Cena bez DPH:</strong> {result.pricing.priceNet ?? "—"} Kč</p>
              <p><strong>Confidence:</strong> {Math.round(result.confidence * 100)} %</p>
              <p><strong>Odpověď zákazníkovi:</strong></p>
              <p className="whitespace-pre-wrap border rounded p-2 bg-muted/30">{result.customerReply}</p>
              {result.recommendedItems.length > 0 && (
                <>
                  <p className="font-medium mt-2">Položky</p>
                  <ul className="list-disc pl-5">
                    {result.recommendedItems.map((i, idx) => (
                      <li key={idx}>{i.name} — {i.quantity} {i.unit} — {i.lineNet} Kč</li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Jak AI došla k výsledku</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              {contextSummary && (
                <div className="space-y-1">
                  <p>Typ poptávky: {String(contextSummary.typeRuleName ?? contextSummary.inquiryType ?? "—")}</p>
                  <p>Použité znalosti: {(contextSummary.knowledgeDocuments as string[] | undefined)?.join(", ") || "—"}</p>
                  <p>Použité vzory: {(contextSummary.similarQuoteSubjects as string[] | undefined)?.join(", ") || "—"}</p>
                </div>
              )}
              {result.priceExplainability && (
                <>
                  <p>
                    Rozměr:{" "}
                    {result.priceExplainability.dimensions.areaM2 != null
                      ? `${result.priceExplainability.dimensions.areaM2} m²`
                      : "—"}
                  </p>
                  <p className="font-medium">Výpočet (CRM pravidla)</p>
                  <ul className="list-disc pl-5">
                    {result.priceExplainability.appliedLines.map((l, i) => (
                      <li key={i}>{l.expression}</li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function HistoryTab({
  companyId,
  firestore,
}: {
  companyId: string;
  firestore: ReturnType<typeof useFirestore>;
}) {
  const gensQuery = useMemoFirebase(() => {
    if (!firestore || !companyId) return null;
    return query(
      collection(firestore, COMPANIES_COLLECTION, companyId, "ai_generations"),
      orderBy("createdAt", "desc"),
      limit(30)
    );
  }, [firestore, companyId]);
  const { data: gensRaw, isLoading } = useCollection(gensQuery);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historie / feedback</CardTitle>
        <CardDescription>AI návrhy a rozdíly oproti finální nabídce.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (gensRaw ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím žádná historie.</p>
        ) : (
          (gensRaw ?? []).map((g) => {
            const gen = g as Record<string, unknown> & { id: string };
            const validated = gen.validatedOutput as { pricing?: { priceNet?: number }; confidence?: number } | undefined;
            const changes = gen.userChanges as Record<string, { from: unknown; to: unknown }> | null;
            return (
              <div key={gen.id} className="border rounded-lg p-3 mb-2 text-sm">
                <p className="font-medium">Generování {gen.id.slice(0, 8)}…</p>
                <p className="text-xs text-muted-foreground">
                  Cena AI: {validated?.pricing?.priceNet ?? "—"} Kč · confidence:{" "}
                  {validated?.confidence != null ? Math.round(validated.confidence * 100) : "—"} %
                </p>
                {changes && Object.keys(changes).length > 0 && (
                  <div className="mt-2 text-xs">
                    <p className="font-medium">Změny uživatele:</p>
                    {Object.entries(changes).map(([k, v]) => (
                      <p key={k}>{k}: {JSON.stringify(v.from)} → {JSON.stringify(v.to)}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
