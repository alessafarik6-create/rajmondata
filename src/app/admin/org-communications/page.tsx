"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Megaphone, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ORG_CAMPAIGN_TYPE_LABELS, type OrgCampaignType } from "@/lib/platform-org-campaigns/types";

type CampaignListItem = {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  stats?: { targeted?: number; interested?: number; declined?: number };
};

export default function AdminOrgCommunicationsPage() {
  const { toast } = useToast();
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [type, setType] = useState<OrgCampaignType>("offer");
  const [emailNotify, setEmailNotify] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/org-campaigns", { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (data.ok) setList(data.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function previewAudience() {
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/org-campaigns/audience-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: { mode: "all" } }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setAudienceCount(data.count);
      toast({
        title: "Příjemci",
        description: `${data.count} organizací, ${data.emailCount} kontaktních e-mailů.`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function runAi() {
    if (!aiPrompt.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/org-campaigns/ai-generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, style: "sales", type }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const d = data.draft;
      setTitle(d.title ?? title);
      setShortDescription(d.shortDescription ?? "");
      setBodyHtml(d.bodyHtml ?? "");
      setEmailSubject(d.emailSubject ?? "");
      if (d.clarificationNote) {
        toast({ title: "AI upozornění", description: d.clarificationNote });
      }
    } catch (e) {
      toast({ variant: "destructive", title: "AI", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const payload = {
        title,
        shortDescription,
        bodyHtml,
        type,
        audience: { mode: "all" },
        emailNotify,
        emailSubject: emailSubject || `RAJMONDATA – ${title}`,
        imageUrl: imageUrl || null,
      };
      const url = selectedId ? `/api/superadmin/org-campaigns/${selectedId}` : "/api/superadmin/org-campaigns";
      const res = await fetch(url, {
        method: selectedId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Uložení selhalo");
      if (!selectedId && data.id) setSelectedId(data.id);
      toast({ title: "Uloženo" });
      await loadList();
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!selectedId) {
      toast({ variant: "destructive", title: "Nejdříve uložte koncept." });
      return;
    }
    if (!confirm(`Publikovat kampaň pro ${audienceCount ?? "?"} organizací?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/org-campaigns/${selectedId}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast({
        title: "Publikováno",
        description: `Osloveno ${data.targeted} organizací, e-mail ve frontě: ${data.emailsQueued}.`,
      });
      await loadList();
    } catch (e) {
      toast({ variant: "destructive", title: "Publikace", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/superadmin/org-campaigns/upload-image", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setImageUrl(data.url);
    } catch (e) {
      toast({ variant: "destructive", title: "Obrázek", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Megaphone className="h-6 w-6 text-orange-500" />
        <h1 className="text-2xl font-semibold">Komunikace s organizacemi</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kampaně</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`w-full rounded-md border p-2 text-left text-sm ${selectedId === c.id ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : ""}`}
                onClick={() => setSelectedId(c.id)}
              >
                <p className="font-medium line-clamp-2">{c.title ?? c.id}</p>
                <p className="text-xs text-muted-foreground">
                  {c.status} · {c.stats?.interested ?? 0} zájemců
                </p>
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setSelectedId(null);
                setTitle("");
                setShortDescription("");
                setBodyHtml("");
              }}
            >
              Nová kampaň
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Typ</Label>
              <select
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as OrgCampaignType)}
              >
                {Object.entries(ORG_CAMPAIGN_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 rounded-md border p-3 bg-muted/20">
              <Label className="flex items-center gap-1">
                <Sparkles className="h-4 w-4" /> Vygenerovat pomocí AI
              </Label>
              <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2} />
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void runAi()}>
                Generovat
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Nadpis</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Krátký popis</Label>
              <Textarea value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Podrobný obsah (HTML)</Label>
              <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={6} />
            </div>
            <div className="space-y-2">
              <Label>Obrázek</Label>
              <Input type="file" accept="image/*" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f);
              }} />
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="max-h-40 rounded-md object-contain" />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label>Odeslat e-mailové upozornění</Label>
              <Switch checked={emailNotify} onCheckedChange={setEmailNotify} />
            </div>
            {emailNotify ? (
              <div className="space-y-2">
                <Label>Předmět e-mailu</Label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void previewAudience()}>
                Spočítat příjemce
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveDraft()}>
                Uložit koncept
              </Button>
              <Button
                type="button"
                className="bg-orange-500 hover:bg-orange-600 text-black"
                disabled={busy}
                onClick={() => void publish()}
              >
                Publikovat
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
