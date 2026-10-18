"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Megaphone, Sparkles, Mail, Monitor, Smartphone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ORG_CAMPAIGN_TYPE_LABELS,
  type OrgCampaignAudience,
  type OrgCampaignAudienceMode,
  type OrgCampaignDeliveryChannel,
  type OrgCampaignType,
} from "@/lib/platform-org-campaigns/types";
import { ORG_CAMPAIGN_PRESETS } from "@/lib/platform-org-campaigns/campaign-presets";
import { buildOrgCampaignEmailHtml } from "@/lib/platform-org-campaigns/email-template";
import { OrgCampaignRecipientPicker } from "@/components/admin/org-campaign-recipient-picker";

type CampaignListItem = {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  stats?: Record<string, number | undefined>;
};

const AUDIENCE_MODES: { value: OrgCampaignAudienceMode; label: string }[] = [
  { value: "all", label: "Všechny organizace" },
  { value: "selected", label: "Vybrané organizace" },
  { value: "active", label: "Aktivní licence" },
  { value: "trial", label: "Trial" },
  { value: "inactive", label: "Neaktivní" },
  { value: "subscription_ending", label: "Končící předplatné (14 dní)" },
  { value: "plan", label: "Podle tarifu" },
  { value: "licensed", label: "S aktivní licencí" },
];

export function OrgCommunicationsWorkspace() {
  const { toast } = useToast();
  const [list, setList] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sendHistory, setSendHistory] = useState<unknown[]>([]);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSubject, setTestSubject] = useState("");
  const [republishOpen, setRepublishOpen] = useState(false);
  const [republishCount, setRepublishCount] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [type, setType] = useState<OrgCampaignType>("offer");
  const [emailNotify, setEmailNotify] = useState(true);
  const [emailMarketing, setEmailMarketing] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [ctaLabel, setCtaLabel] = useState("Zjistit více");
  const [ctaUrl, setCtaUrl] = useState("");
  const [consultationEnabled, setConsultationEnabled] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<OrgCampaignDeliveryChannel>("both");
  const [audienceMode, setAudienceMode] = useState<OrgCampaignAudienceMode>("all");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [campaignRecipients, setCampaignRecipients] = useState<Array<Record<string, unknown>>>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, number | undefined> | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiAudienceHint, setAiAudienceHint] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [automation, setAutomation] = useState({
    inactive14Enabled: false,
    inactive30Enabled: false,
    inactive60Enabled: false,
    subscriptionEndingEnabled: false,
    newAccountHelpEnabled: false,
    minDaysBetweenMarketingEmails: 7,
  });
  const [consultSettings, setConsultSettings] = useState({
    slotDurationMinutes: 30 as 15 | 30 | 45 | 60,
    maxBookingsPerDay: 8,
    meetLinkTemplate: "",
    adminNotifyEmail: "",
  });

  const audience: OrgCampaignAudience = useMemo(() => {
    if (audienceMode === "selected") {
      return { mode: "selected", companyIds: [...selectedCompanyIds] };
    }
    return { mode: audienceMode };
  }, [audienceMode, selectedCompanyIds]);

  const emailPreviewHtml = useMemo(
    () =>
      buildOrgCampaignEmailHtml({
        organizationName: "Ukázková organizace s.r.o.",
        title: title || "Náhled kampaně",
        shortDescription: shortDescription || "",
        bodyHtml: bodyHtml || undefined,
        imageUrl,
        campaignUrl: "https://rajmondata.cz/portal/campaigns/preview",
        ctaLabel,
        ctaUrl: ctaUrl || "https://rajmondata.cz/portal/dashboard",
        consultationUrl: consultationEnabled ? "https://rajmondata.cz/rezervace-konzultace" : null,
      }),
    [title, shortDescription, bodyHtml, imageUrl, ctaLabel, ctaUrl, consultationEnabled]
  );

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

  const loadCampaign = useCallback(async (id: string) => {
    const res = await fetch(`/api/superadmin/org-campaigns/${id}`, { credentials: "include" });
    const data = await res.json();
    if (!data.ok) return;
    const c = data.campaign as Record<string, unknown>;
    setTitle(String(c.title ?? ""));
    setShortDescription(String(c.shortDescription ?? ""));
    setBodyHtml(String(c.bodyHtml ?? ""));
    setType((c.type as OrgCampaignType) ?? "offer");
    setEmailNotify(c.emailNotify !== false);
    setEmailMarketing(c.emailMarketing !== false);
    setEmailSubject(String(c.emailSubject ?? ""));
    setImageUrl(String(c.imageUrl ?? ""));
    setCtaLabel(String(c.ctaLabel ?? "Zjistit více"));
    setCtaUrl(String(c.ctaUrl ?? ""));
    setConsultationEnabled(c.consultationEnabled === true);
    setDeliveryChannel((c.deliveryChannel as OrgCampaignDeliveryChannel) ?? "both");
    const aud = c.audience as OrgCampaignAudience | undefined;
    setAudienceMode(aud?.mode ?? "all");
    setSelectedCompanyIds(aud?.companyIds ?? []);
    setSendHistory([]);
    const hist = await fetch(`/api/superadmin/org-campaigns/${id}/send-history`, {
      credentials: "include",
    });
    const histData = await hist.json();
    if (histData.ok) setSendHistory(histData.batches ?? []);
    const rec = await fetch(`/api/superadmin/org-campaigns/${id}/recipients`, { credentials: "include" });
    const recData = await rec.json();
    if (recData.ok) {
      setCampaignRecipients(recData.recipients ?? []);
      setCampaignStats(recData.stats ?? null);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void fetch("/api/superadmin/org-campaign-automation", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.settings) setAutomation(d.settings);
      });
    void fetch("/api/superadmin/consultation-settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.settings) {
          setConsultSettings({
            slotDurationMinutes: d.settings.slotDurationMinutes ?? 30,
            maxBookingsPerDay: d.settings.maxBookingsPerDay ?? 8,
            meetLinkTemplate: d.settings.meetLinkTemplate ?? "",
            adminNotifyEmail: d.settings.adminNotifyEmail ?? "",
          });
        }
      });
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadCampaign(selectedId);
  }, [selectedId, loadCampaign]);

  async function previewAudience() {
    setBusy(true);
    try {
      const res = await fetch("/api/superadmin/org-campaigns/audience-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, search: audienceSearch, emailMarketing }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setAudienceCount(data.count);
      setRepublishCount(data.count);
      toast({
        title: "Příjemci",
        description: `${data.count} organizací · ${data.emailCount} s kontaktním e-mailem.`,
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
      setCtaLabel(d.ctaLabel ?? ctaLabel);
      if (d.recommendedAudience) setAiAudienceHint(String(d.recommendedAudience));
    } catch (e) {
      toast({ variant: "destructive", title: "AI", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  function buildPayload() {
    return {
      title,
      shortDescription,
      bodyHtml,
      type,
      audience,
      emailNotify: deliveryChannel !== "dashboard" && emailNotify,
      emailMarketing,
      emailSubject: emailSubject || `RAJMONDATA – ${title}`,
      imageUrl: imageUrl || null,
      ctaLabel,
      ctaUrl: ctaUrl || null,
      consultationEnabled,
      deliveryChannel,
      publishAt: publishAt || null,
    };
  }

  async function saveDraft() {
    setBusy(true);
    try {
      const payload = buildPayload();
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

  async function publish(resend = false) {
    if (!selectedId) {
      toast({ variant: "destructive", title: "Nejdříve uložte koncept." });
      return;
    }
    await saveDraft();
    setRepublishOpen(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/org-campaigns/${selectedId}/publish`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resendEmail: resend, deliveryChannel }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast({
        title: resend ? "Odesláno znovu" : "Publikováno",
        description: `Příjemců: ${data.targeted}, ve frontě: ${data.emailsQueued}, zpracováno: ${data.queueProcessed ?? 0}.`,
      });
      await loadList();
      await loadCampaign(selectedId);
    } catch (e) {
      toast({ variant: "destructive", title: "Odeslání", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/org-campaigns/${selectedId}/test-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testEmail, subject: testSubject || emailSubject }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast({ title: "Test odeslán", description: data.message });
      setTestDialogOpen(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Test e-mail", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function duplicateCampaign() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/org-campaigns/${selectedId}/duplicate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setSelectedId(data.id);
      await loadList();
      toast({ title: "Duplikováno" });
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  async function requeueFailedEmails() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/superadmin/org-campaigns/${selectedId}/requeue-failed`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast({
        title: "Fronta obnovena",
        description: `Znovu zařazeno: ${data.requeued}, zpracováno: ${data.processed ?? 0}.`,
      });
      await loadCampaign(selectedId);
    } catch (e) {
      toast({ variant: "destructive", title: "Chyba", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  function exportRecipientsCsv() {
    const rows = campaignRecipients;
    if (!rows.length) return;
    const header = ["organizationId", "organizationName", "emailStatus", "targetEmails", "emailError"];
    const lines = [
      header.join(";"),
      ...rows.map((r) =>
        [
          r.organizationId,
          r.organizationName,
          r.emailStatus,
          Array.isArray(r.targetEmails) ? (r.targetEmails as string[]).join("|") : "",
          r.emailError,
        ]
          .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
          .join(";")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kampaň-${selectedId}-prijemci.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function archiveCampaign() {
    if (!selectedId || !confirm("Archivovat kampaň?")) return;
    await fetch(`/api/superadmin/org-campaigns/${selectedId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    toast({ title: "Archivováno" });
    await loadList();
  }

  function applyPreset(presetId: string) {
    const p = ORG_CAMPAIGN_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setTitle(p.title);
    setShortDescription(p.shortDescription);
    setBodyHtml(p.bodyHtml);
    setType(p.type);
    setCtaLabel(p.ctaLabel);
    setCtaUrl(p.ctaUrl);
    setEmailSubject(p.emailSubject);
    setConsultationEnabled(p.consultationEnabled);
  }

  const selectedStats = list.find((c) => c.id === selectedId)?.stats;

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
                  {c.status} · {c.stats?.interested ?? 0} zájem · {c.stats?.emailsSent ?? 0} e-mailů
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

        <div className="space-y-4">
          {selectedId ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Akce kampaně</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveDraft()}>
                  Upravit / uložit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPreviewMode("desktop")}>
                  Náhled
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void previewAudience().then(() => setRepublishOpen(true));
                  }}
                >
                  Odeslat znovu
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void duplicateCampaign()}>
                  Duplikovat
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void requeueFailedEmails()}>
                  Znovu neúspěšné e-maily
                </Button>
                <Button size="sm" variant="outline" disabled={!campaignRecipients.length} onClick={exportRecipientsCsv}>
                  Export CSV
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void archiveCampaign()}>
                  Archivovat
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {ORG_CAMPAIGN_PRESETS.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="secondary" onClick={() => applyPreset(p.id)}>
                    {p.label}
                  </Button>
                ))}
              </div>
              <div className="space-y-2 rounded-md border p-3 bg-muted/20">
                <Label className="flex items-center gap-1">
                  <Sparkles className="h-4 w-4" /> Vygenerovat pomocí AI
                </Label>
                <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2} />
                {aiAudienceHint ? (
                  <p className="text-xs text-muted-foreground">Doporučené publikum: {aiAudienceHint}</p>
                ) : null}
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void runAi()}>
                  Generovat (vyžaduje schválení před odesláním)
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
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
                <div className="space-y-2">
                  <Label>Kanál doručení</Label>
                  <select
                    className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                    value={deliveryChannel}
                    onChange={(e) =>
                      setDeliveryChannel(e.target.value as OrgCampaignDeliveryChannel)
                    }
                  >
                    <option value="both">Dashboard + e-mail</option>
                    <option value="dashboard">Pouze dashboard</option>
                    <option value="email">Pouze e-mail</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Publikum</Label>
                <select
                  className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={audienceMode}
                  onChange={(e) => setAudienceMode(e.target.value as OrgCampaignAudienceMode)}
                >
                  {AUDIENCE_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {audienceMode === "selected" ? (
                  <OrgCampaignRecipientPicker
                    selectedIds={selectedCompanyIds}
                    onChangeSelectedIds={setSelectedCompanyIds}
                    emailMarketing={emailMarketing}
                    disabled={busy}
                  />
                ) : (
                  <Input
                    placeholder="Filtrovat organizace podle názvu, IČO nebo e-mailu…"
                    value={audienceSearch}
                    onChange={(e) => setAudienceSearch(e.target.value)}
                  />
                )}
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tlačítko – text</Label>
                  <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Tlačítko – URL</Label>
                  <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label>Domluvit konzultaci v e-mailu / kampani</Label>
                <Switch checked={consultationEnabled} onCheckedChange={setConsultationEnabled} />
              </div>
              <div className="space-y-2">
                <Label>Obrázek</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void (async () => {
                      setBusy(true);
                      try {
                        const fd = new FormData();
                        fd.set("file", f);
                        const res = await fetch("/api/superadmin/org-campaigns/upload-image", {
                          method: "POST",
                          credentials: "include",
                          body: fd,
                        });
                        const data = await res.json();
                        if (data.ok) setImageUrl(data.url);
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                />
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="max-h-40 rounded-md object-contain" />
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label>Marketingový e-mail (GDPR – lze odhlásit)</Label>
                <Switch checked={emailMarketing} onCheckedChange={setEmailMarketing} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label>E-mailové upozornění</Label>
                <Switch checked={emailNotify} onCheckedChange={setEmailNotify} />
              </div>
              {emailNotify ? (
                <div className="space-y-2">
                  <Label>Předmět e-mailu</Label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Naplánovat odeslání (volitelné)</Label>
                <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
              </div>
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
                  onClick={() => void publish(false)}
                >
                  Publikovat
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-1 border-orange-300"
                  disabled={!selectedId || busy}
                  onClick={() => setTestDialogOpen(true)}
                >
                  <Mail className="h-4 w-4" /> Odeslat testovací e-mail
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Náhled e-mailu</CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={previewMode === "desktop" ? "default" : "outline"}
                  onClick={() => setPreviewMode("desktop")}
                >
                  <Monitor className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={previewMode === "mobile" ? "default" : "outline"}
                  onClick={() => setPreviewMode("mobile")}
                >
                  <Smartphone className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <iframe
                title="Náhled e-mailu"
                srcDoc={emailPreviewHtml}
                className={`w-full rounded-md border bg-white ${previewMode === "mobile" ? "max-w-[375px] mx-auto h-[520px]" : "h-[420px]"}`}
              />
            </CardContent>
          </Card>

          {selectedId && (selectedStats || campaignStats) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Statistiky</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {(() => {
                  const s = campaignStats ?? selectedStats ?? {};
                  const queued = Number(s.emailsQueued ?? 0);
                  const sent = Number(s.emailsSent ?? 0);
                  const err = Number(s.emailsError ?? 0);
                  const pending = Math.max(0, queued - sent - err);
                  return (
                    <>
                      <div>Příjemci: {s.targeted ?? 0}</div>
                      <div>Ve frontě / čeká: {pending}</div>
                      <div>Přijato poskytovatelem: {sent}</div>
                      <div>Chyby: {err}</div>
                      <div>Zájem: {s.interested ?? 0}</div>
                      <div>Rezervace: {s.consultationsBooked ?? 0}</div>
                      <div>Odhlášení: {s.marketingUnsubscribes ?? 0}</div>
                      <div>Podpora: {s.support ?? 0}</div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          ) : null}

          {campaignRecipients.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historie příjemců (e-mail)</CardTitle>
              </CardHeader>
              <CardContent className="max-h-64 overflow-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="p-1">Organizace</th>
                      <th className="p-1 hidden sm:table-cell">E-mail</th>
                      <th className="p-1">Stav</th>
                      <th className="p-1 hidden md:table-cell">Pokusy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignRecipients.slice(0, 200).map((r) => (
                      <tr key={String(r.organizationId)} className="border-b">
                        <td className="p-1">{String(r.organizationName ?? r.organizationId)}</td>
                        <td className="p-1 hidden sm:table-cell truncate max-w-[140px]">
                          {Array.isArray(r.targetEmails)
                            ? (r.targetEmails as string[]).join(", ")
                            : "—"}
                        </td>
                        <td className="p-1">{String(r.emailStatus ?? "—")}</td>
                        <td className="p-1 hidden md:table-cell">{String(r.emailAttempts ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {sendHistory.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Historie odeslání</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm max-h-48 overflow-y-auto">
                {sendHistory.map((row, i) => {
                  const b = row as Record<string, unknown>;
                  return (
                    <div key={String(b.batchId ?? i)} className="rounded border p-2">
                      {String(b.deliveryChannel ?? "—")} · {String(b.targeted ?? 0)} org · e-mail ve frontě:{" "}
                      {String(b.emailsQueued ?? 0)} · odesláno: {String(b.emailsSent ?? 0)}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odeslat testovací e-mail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>E-mail příjemce</Label>
              <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-1">
              <Label>Předmět</Label>
              <Input value={testSubject} onChange={(e) => setTestSubject(e.target.value)} placeholder={emailSubject} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              Zrušit
            </Button>
            <Button className="bg-orange-500 text-black" disabled={busy} onClick={() => void sendTestEmail()}>
              Odeslat test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automatické kampaně (vypnuto ve výchozím stavu)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {(
            [
              ["inactive14Enabled", "Nepřihlášení 14 dní"],
              ["inactive30Enabled", "Nepřihlášení 30 dní"],
              ["inactive60Enabled", "Nepřihlášení 60 dní"],
              ["subscriptionEndingEnabled", "Končící předplatné"],
              ["newAccountHelpEnabled", "Nový účet – nabídka pomoci"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <Switch
                checked={automation[key]}
                onCheckedChange={(v) => setAutomation((a) => ({ ...a, [key]: v }))}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Min. dní mezi marketing e-maily</Label>
            <Input
              type="number"
              className="max-w-[80px]"
              value={automation.minDaysBetweenMarketingEmails}
              onChange={(e) =>
                setAutomation((a) => ({
                  ...a,
                  minDaysBetweenMarketingEmails: Number(e.target.value) || 7,
                }))
              }
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void fetch("/api/superadmin/org-campaign-automation", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(automation),
              }).then(() => toast({ title: "Automatizace uložena" }))
            }
          >
            Uložit automatizaci
          </Button>
          <p className="text-xs text-muted-foreground">
            Spouštění scénářů vyžaduje naplánovaný job na serveru; nastavení zde pouze aktivuje pravidla a frekvenci.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nastavení rezervací konzultací</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Délka slotu (min)</Label>
            <select
              className="flex h-10 w-full rounded-md border px-3 text-sm"
              value={consultSettings.slotDurationMinutes}
              onChange={(e) =>
                setConsultSettings((s) => ({
                  ...s,
                  slotDurationMinutes: Number(e.target.value) as 15 | 30 | 45 | 60,
                }))
              }
            >
              {[15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Max. rezervací / den</Label>
            <Input
              type="number"
              value={consultSettings.maxBookingsPerDay}
              onChange={(e) =>
                setConsultSettings((s) => ({ ...s, maxBookingsPerDay: Number(e.target.value) || 8 }))
              }
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Šablona odkazu online schůzky (volitelné)</Label>
            <Input
              value={consultSettings.meetLinkTemplate}
              onChange={(e) => setConsultSettings((s) => ({ ...s, meetLinkTemplate: e.target.value }))}
              placeholder="https://meet.google.com/xxx nebo Teams odkaz"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>E-mail pro upozornění admina</Label>
            <Input
              type="email"
              value={consultSettings.adminNotifyEmail}
              onChange={(e) => setConsultSettings((s) => ({ ...s, adminNotifyEmail: e.target.value }))}
            />
          </div>
          <Button
            size="sm"
            className="sm:col-span-2 w-fit"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void fetch("/api/superadmin/consultation-settings", {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(consultSettings),
              }).then(() => toast({ title: "Nastavení konzultací uloženo" }))
            }
          >
            Uložit nastavení konzultací
          </Button>
        </CardContent>
      </Card>

      <Dialog open={republishOpen} onOpenChange={setRepublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odeslat kampaň znovu?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Kampaň zůstane stejná, vytvoří se nový záznam v historii odeslání. Příjemců:{" "}
            {republishCount ?? audienceCount ?? "—"} (kanál: {deliveryChannel}).
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepublishOpen(false)}>
              Zrušit
            </Button>
            <Button className="bg-orange-500 text-black" disabled={busy} onClick={() => void publish(true)}>
              Potvrdit odeslání
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
