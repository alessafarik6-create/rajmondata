"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { PlatformSeoHeroImage, PlatformSeoPromoVideo } from "@/lib/platform-seo-sanitize";

const HERO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const PROMO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";

type UploadKind = "hero" | "promo" | "register_hero" | "register_promo" | "login_hero" | "login_promo";

function parseImages(raw: unknown): PlatformSeoHeroImage[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((row, i) => {
    const o = (row || {}) as Record<string, unknown>;
    return {
      url: String(o.url || ""),
      storagePath: String(o.storagePath || ""),
      alt: String(o.alt || ""),
      order: typeof o.order === "number" ? o.order : i,
    };
  });
}

function parseVideo(raw: unknown): { video: PlatformSeoPromoVideo | null; embed: string } {
  if (raw && typeof raw === "object") {
    const pv = raw as Record<string, unknown>;
    const v: PlatformSeoPromoVideo = {
      url: String(pv.url || ""),
      storagePath: pv.storagePath != null ? String(pv.storagePath) : null,
      type: pv.type === "embed" ? "embed" : "file",
    };
    return { video: v, embed: v.type === "embed" ? String(pv.url || "") : "" };
  }
  return { video: null, embed: "" };
}

export default function AdminSeoPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<UploadKind | null>(null);

  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [landingLead, setLandingLead] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [registerButtonText, setRegisterButtonText] = useState("");
  const [loginButtonText, setLoginButtonText] = useState("");
  const [benefitsTitle, setBenefitsTitle] = useState("");
  const [benefitsText, setBenefitsText] = useState("");
  const [pricingTitle, setPricingTitle] = useState("");
  const [pricingSubtitle, setPricingSubtitle] = useState("");

  const [registerPageTitle, setRegisterPageTitle] = useState("");
  const [registerPageSubtitle, setRegisterPageSubtitle] = useState("");
  const [registerPageHelperText, setRegisterPageHelperText] = useState("");

  const [loginPageTitle, setLoginPageTitle] = useState("");
  const [loginPageSubtitle, setLoginPageSubtitle] = useState("");
  const [loginWelcomeText, setLoginWelcomeText] = useState("");
  const [loginEmailLabel, setLoginEmailLabel] = useState("");
  const [loginPasswordLabel, setLoginPasswordLabel] = useState("");

  const [heroImages, setHeroImages] = useState<PlatformSeoHeroImage[]>([]);
  const [registerImages, setRegisterImages] = useState<PlatformSeoHeroImage[]>([]);
  const [loginImages, setLoginImages] = useState<PlatformSeoHeroImage[]>([]);

  const [promoVideo, setPromoVideo] = useState<PlatformSeoPromoVideo | null>(null);
  const [promoEmbedUrl, setPromoEmbedUrl] = useState("");

  const [registerVideo, setRegisterVideo] = useState<PlatformSeoPromoVideo | null>(null);
  const [registerEmbedUrl, setRegisterEmbedUrl] = useState("");

  const [loginVideo, setLoginVideo] = useState<PlatformSeoPromoVideo | null>(null);
  const [loginEmbedUrl, setLoginEmbedUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/seo", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : "Načtení SEO se nezdařilo.",
        });
        return;
      }
      if (typeof data.metaTitle === "string") setMetaTitle(data.metaTitle);
      if (typeof data.metaDescription === "string") setMetaDescription(data.metaDescription);
      if (typeof data.keywords === "string") setKeywords(data.keywords);
      if (typeof data.ogTitle === "string") setOgTitle(data.ogTitle);
      if (typeof data.ogDescription === "string") setOgDescription(data.ogDescription);
      if (typeof data.canonicalUrl === "string") setCanonicalUrl(data.canonicalUrl);
      if (typeof data.landingLead === "string") setLandingLead(data.landingLead);
      if (typeof data.heroTitle === "string") setHeroTitle(data.heroTitle);
      if (typeof data.heroSubtitle === "string") setHeroSubtitle(data.heroSubtitle);
      if (typeof data.registerButtonText === "string") setRegisterButtonText(data.registerButtonText);
      if (typeof data.loginButtonText === "string") setLoginButtonText(data.loginButtonText);
      if (typeof data.benefitsTitle === "string") setBenefitsTitle(data.benefitsTitle);
      if (typeof data.benefitsText === "string") setBenefitsText(data.benefitsText);
      if (typeof data.pricingTitle === "string") setPricingTitle(data.pricingTitle);
      if (typeof data.pricingSubtitle === "string") setPricingSubtitle(data.pricingSubtitle);
      if (typeof data.registerPageTitle === "string") setRegisterPageTitle(data.registerPageTitle);
      if (typeof data.registerPageSubtitle === "string") setRegisterPageSubtitle(data.registerPageSubtitle);
      if (typeof data.registerPageHelperText === "string")
        setRegisterPageHelperText(data.registerPageHelperText);
      if (typeof data.loginPageTitle === "string") setLoginPageTitle(data.loginPageTitle);
      if (typeof data.loginPageSubtitle === "string") setLoginPageSubtitle(data.loginPageSubtitle);
      if (typeof data.loginWelcomeText === "string") setLoginWelcomeText(data.loginWelcomeText);
      if (typeof data.loginEmailLabel === "string") setLoginEmailLabel(data.loginEmailLabel);
      if (typeof data.loginPasswordLabel === "string") setLoginPasswordLabel(data.loginPasswordLabel);

      setHeroImages(parseImages(data.heroImages));
      setRegisterImages(parseImages(data.registerImages));
      setLoginImages(parseImages(data.loginImages));

      const p = parseVideo(data.promoVideo);
      setPromoVideo(p.video);
      setPromoEmbedUrl(p.embed);

      const r = parseVideo(data.registerVideo);
      setRegisterVideo(r.video);
      setRegisterEmbedUrl(r.embed);

      const l = parseVideo(data.loginVideo);
      setLoginVideo(l.video);
      setLoginEmbedUrl(l.embed);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleteStoragePath = async (path: string) => {
    if (!path.startsWith("platform/landing/")) return;
    try {
      const res = await fetch(
        `/api/superadmin/seo-media-delete?path=${encodeURIComponent(path)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error("[admin seo delete]", j);
      }
    } catch (e) {
      console.error("[admin seo delete]", e);
    }
  };

  const uploadFile = async (kind: UploadKind, file: File) => {
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const res = await fetch("/api/superadmin/seo-media-upload", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Nahrání se nezdařilo.");
      }
      const url = String(j.url || "");
      const storagePath = String(j.storagePath || "");
      if (!url || !storagePath) throw new Error("Neplatná odpověď serveru.");

      if (kind === "hero") {
        setHeroImages((prev) => [...prev, { url, storagePath, alt: "", order: prev.length }]);
      } else if (kind === "register_hero") {
        setRegisterImages((prev) => [...prev, { url, storagePath, alt: "", order: prev.length }]);
      } else if (kind === "login_hero") {
        setLoginImages((prev) => [...prev, { url, storagePath, alt: "", order: prev.length }]);
      } else if (kind === "promo") {
        setPromoVideo({ type: "file", url, storagePath });
        setPromoEmbedUrl("");
      } else if (kind === "register_promo") {
        setRegisterVideo({ type: "file", url, storagePath });
        setRegisterEmbedUrl("");
      } else if (kind === "login_promo") {
        setLoginVideo({ type: "file", url, storagePath });
        setLoginEmbedUrl("");
      }
      toast({ title: "Soubor nahrán", description: "Nezapomeňte uložit SEO." });
    } catch (e) {
      console.error("[admin seo upload]", e);
      toast({
        variant: "destructive",
        title: "Nahrání",
        description: e instanceof Error ? e.message : "Chyba.",
      });
    } finally {
      setUploading(null);
    }
  };

  const moveRow = (setList: React.Dispatch<React.SetStateAction<PlatformSeoHeroImage[]>>, idx: number, dir: -1 | 1) => {
    setList((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((h, i) => ({ ...h, order: i }));
    });
  };

  const removeRow = (setList: React.Dispatch<React.SetStateAction<PlatformSeoHeroImage[]>>, idx: number) => {
    setList((prev) => {
      const row = prev[idx];
      if (row?.storagePath) void deleteStoragePath(row.storagePath);
      return prev.filter((_, i) => i !== idx).map((h, i) => ({ ...h, order: i }));
    });
  };

  const applyEmbed = (
    url: string,
    setVideo: React.Dispatch<React.SetStateAction<PlatformSeoPromoVideo | null>>,
    errLabel: string
  ) => {
    const u = url.trim();
    if (!u) {
      toast({ variant: "destructive", title: `Vložte URL videa (YouTube) — ${errLabel}.` });
      return;
    }
    setVideo({ type: "embed", url: u, storagePath: null });
    toast({ title: "Odkaz nastaven", description: "Uložte SEO pro zápis do databáze." });
  };

  const removeVideo = async (v: PlatformSeoPromoVideo | null, clear: () => void) => {
    if (v?.storagePath) await deleteStoragePath(v.storagePath);
    clear();
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/seo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          metaTitle,
          metaDescription,
          keywords,
          ogTitle,
          ogDescription,
          canonicalUrl,
          landingLead,
          heroTitle,
          heroSubtitle,
          registerButtonText,
          loginButtonText,
          benefitsTitle,
          benefitsText,
          pricingTitle,
          pricingSubtitle,
          registerPageTitle,
          registerPageSubtitle,
          registerPageHelperText,
          loginPageTitle,
          loginPageSubtitle,
          loginWelcomeText,
          loginEmailLabel,
          loginPasswordLabel,
          heroImages,
          registerImages,
          loginImages,
          promoVideo,
          registerVideo,
          loginVideo,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Uložení se nezdařilo.");
      }
      toast({ title: "SEO uloženo", description: "Nastavení a média byla uložena." });
      await load();
    } catch (e) {
      console.error("[admin seo save]", e);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderImageRows = (
    list: PlatformSeoHeroImage[],
    setList: React.Dispatch<React.SetStateAction<PlatformSeoHeroImage[]>>,
    uploadKind: "hero" | "register_hero" | "login_hero",
    inputId: string
  ) => (
    <>
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept={HERO_ACCEPT}
          className="hidden"
          id={inputId}
          disabled={!!uploading || loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadFile(uploadKind, f);
          }}
        />
        <Button type="button" variant="outline" size="sm" asChild disabled={!!uploading || loading}>
          <label htmlFor={inputId} className="cursor-pointer">
            {uploading === uploadKind ? <Loader2 className="h-4 w-4 animate-spin" /> : "Nahrát obrázek"}
          </label>
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-slate-500">Zatím žádné obrázky.</p>
      ) : (
        <div className="space-y-4">
          {list.map((h, idx) => (
            <div
              key={`${h.storagePath}-${idx}`}
              className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-start"
            >
              <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-md bg-slate-200 sm:h-28 sm:w-40">
                {h.url ? (
                  <Image src={h.url} alt={h.alt || "náhled"} fill className="object-cover" unoptimized />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Label>Alt text</Label>
                <Input
                  className="bg-white"
                  value={h.alt}
                  onChange={(e) => {
                    const v = e.target.value;
                    setList((prev) => prev.map((x, i) => (i === idx ? { ...x, alt: v } : x)));
                  }}
                  placeholder="Stručný popis"
                />
                <p className="truncate text-xs text-slate-500">{h.url}</p>
              </div>
              <div className="flex flex-row gap-1 sm:flex-col">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={idx === 0}
                  onClick={() => moveRow(setList, idx, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={idx >= list.length - 1}
                  onClick={() => moveRow(setList, idx, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="text-red-700"
                  onClick={() => removeRow(setList, idx)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const videoBlock = (
    v: PlatformSeoPromoVideo | null,
    embed: string,
    setEmbed: (s: string) => void,
    onApplyEmbed: () => void,
    uploadKind: "promo" | "register_promo" | "login_promo",
    inputId: string,
    onRemove: () => void
  ) => (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">YouTube odkaz nebo nahrání MP4/WebM do úložiště.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label>Odkaz (YouTube)</Label>
          <Input
            className="bg-white"
            value={embed}
            onChange={(e) => setEmbed(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </div>
        <Button type="button" variant="secondary" onClick={onApplyEmbed}>
          Použít odkaz
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={PROMO_ACCEPT}
          className="hidden"
          id={inputId}
          disabled={!!uploading || loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadFile(uploadKind, f);
          }}
        />
        <Button type="button" variant="outline" asChild disabled={!!uploading || loading}>
          <label htmlFor={inputId} className="cursor-pointer">
            {uploading === uploadKind ? <Loader2 className="h-4 w-4 animate-spin" /> : "Nahrát video"}
          </label>
        </Button>
        {v ? (
          <Button type="button" variant="destructive" onClick={onRemove}>
            Odstranit
          </Button>
        ) : null}
      </div>
      {v ? (
        <div className="rounded-md border border-slate-200 bg-slate-900 p-2 text-xs text-slate-200">
          <p className="font-medium text-white">Aktivní: {v.type === "embed" ? "odkaz" : "soubor"}</p>
          <p className="mt-1 break-all opacity-90">{v.url}</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">SEO</h1>
        <p className="mt-1 text-slate-800">
          Texty a média pro veřejnou úvodní stránku, registraci a přihlášení (pouze superadmin).
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Veřejné stránky — SEO a texty</CardTitle>
          <Button type="button" onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 max-w-2xl">
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          ) : (
            <>
              <div className="space-y-1">
                <Label>Meta title</Label>
                <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Meta description</Label>
                <Textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  rows={3}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label>Klíčová slova</Label>
                <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Open Graph title</Label>
                <Input value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Open Graph description</Label>
                <Textarea
                  value={ogDescription}
                  onChange={(e) => setOgDescription(e.target.value)}
                  rows={2}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label>Canonical URL</Label>
                <Input value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Úvodní odstavec (lead)</Label>
                <Textarea
                  value={landingLead}
                  onChange={(e) => setLandingLead(e.target.value)}
                  rows={2}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label>Hlavní nadpis (hero)</Label>
                <Input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Podnadpis (hero)</Label>
                <Textarea
                  value={heroSubtitle}
                  onChange={(e) => setHeroSubtitle(e.target.value)}
                  rows={2}
                  className="bg-white"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Text tlačítka registrace</Label>
                  <Input
                    value={registerButtonText}
                    onChange={(e) => setRegisterButtonText(e.target.value)}
                    className="bg-white"
                    placeholder="Registrovat firmu"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Text tlačítka přihlášení</Label>
                  <Input
                    value={loginButtonText}
                    onChange={(e) => setLoginButtonText(e.target.value)}
                    className="bg-white"
                    placeholder="Přihlásit se"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Nadpis sekce výhod</Label>
                <Input value={benefitsTitle} onChange={(e) => setBenefitsTitle(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Text výhod (každý řádek = jeden bod)</Label>
                <Textarea
                  value={benefitsText}
                  onChange={(e) => setBenefitsText(e.target.value)}
                  rows={5}
                  className="bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label>Nadpis tarifů</Label>
                <Input value={pricingTitle} onChange={(e) => setPricingTitle(e.target.value)} className="bg-white" />
              </div>
              <div className="space-y-1">
                <Label>Podnadpis tarifů</Label>
                <Textarea
                  value={pricingSubtitle}
                  onChange={(e) => setPricingSubtitle(e.target.value)}
                  rows={2}
                  className="bg-white"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Úvodní stránka — obrázky (hero)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">JPG, PNG, WebP. Doporučeno více snímků pro rotaci.</p>
          {renderImageRows(heroImages, setHeroImages, "hero", "hero-upload")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Úvodní stránka — video</CardTitle>
        </CardHeader>
        <CardContent className="max-w-2xl">
          {videoBlock(
            promoVideo,
            promoEmbedUrl,
            setPromoEmbedUrl,
            () => applyEmbed(promoEmbedUrl, setPromoVideo, "úvod"),
            "promo",
            "promo-upload",
            () => void removeVideo(promoVideo, () => { setPromoVideo(null); setPromoEmbedUrl(""); })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registrace — texty</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-w-2xl">
          <div className="space-y-1">
            <Label>Nadpis</Label>
            <Input
              className="bg-white"
              value={registerPageTitle}
              onChange={(e) => setRegisterPageTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Podnadpis</Label>
            <Textarea
              className="bg-white"
              rows={2}
              value={registerPageSubtitle}
              onChange={(e) => setRegisterPageSubtitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Pomocný text (info k formuláři)</Label>
            <Textarea
              className="bg-white"
              rows={3}
              value={registerPageHelperText}
              onChange={(e) => setRegisterPageHelperText(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registrace — obrázky a video (levý panel)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderImageRows(registerImages, setRegisterImages, "register_hero", "reg-hero-upl")}
          {videoBlock(
            registerVideo,
            registerEmbedUrl,
            setRegisterEmbedUrl,
            () => applyEmbed(registerEmbedUrl, setRegisterVideo, "registrace"),
            "register_promo",
            "reg-vid-upl",
            () => void removeVideo(registerVideo, () => { setRegisterVideo(null); setRegisterEmbedUrl(""); })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Přihlášení — texty a popisky polí</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-w-2xl">
          <div className="space-y-1">
            <Label>Nadpis stránky (volitelný)</Label>
            <Input className="bg-white" value={loginPageTitle} onChange={(e) => setLoginPageTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Podnadpis / popis pod nadpisem</Label>
            <Textarea
              className="bg-white"
              rows={2}
              value={loginPageSubtitle}
              onChange={(e) => setLoginPageSubtitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Hlavní text (např. Vítejte zpět)</Label>
            <Input
              className="bg-white"
              value={loginWelcomeText}
              onChange={(e) => setLoginWelcomeText(e.target.value)}
              placeholder="Vítejte zpět"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Label: email</Label>
              <Input
                className="bg-white"
                value={loginEmailLabel}
                onChange={(e) => setLoginEmailLabel(e.target.value)}
                placeholder="Emailová adresa"
              />
            </div>
            <div className="space-y-1">
              <Label>Label: heslo</Label>
              <Input
                className="bg-white"
                value={loginPasswordLabel}
                onChange={(e) => setLoginPasswordLabel(e.target.value)}
                placeholder="Heslo"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Přihlášení — obrázek / video (levý panel na desktopu)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderImageRows(loginImages, setLoginImages, "login_hero", "log-hero-upl")}
          {videoBlock(
            loginVideo,
            loginEmbedUrl,
            setLoginEmbedUrl,
            () => applyEmbed(loginEmbedUrl, setLoginVideo, "přihlášení"),
            "login_promo",
            "log-vid-upl",
            () => void removeVideo(loginVideo, () => { setLoginVideo(null); setLoginEmbedUrl(""); })
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving || loading} size="lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit vše (texty + média)"}
        </Button>
      </div>
    </div>
  );
}
