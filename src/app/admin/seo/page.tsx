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
import type {
  PlatformSeoHeroImage,
  PlatformSeoPromoVideo,
} from "@/lib/platform-seo-sanitize";

const HERO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const PROMO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";

export default function AdminSeoPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"hero" | "promo" | null>(null);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [landingLead, setLandingLead] = useState("");
  const [heroImages, setHeroImages] = useState<PlatformSeoHeroImage[]>([]);
  const [promoVideo, setPromoVideo] = useState<PlatformSeoPromoVideo | null>(null);
  const [promoEmbedUrl, setPromoEmbedUrl] = useState("");

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
      if (Array.isArray(data.heroImages)) {
        setHeroImages(
          (data.heroImages as unknown[]).map((row, i) => {
            const o = row as Record<string, unknown>;
            return {
              url: String(o.url || ""),
              storagePath: String(o.storagePath || ""),
              alt: String(o.alt || ""),
              order: typeof o.order === "number" ? o.order : i,
            };
          })
        );
      } else {
        setHeroImages([]);
      }
      if (data.promoVideo && typeof data.promoVideo === "object") {
        const pv = data.promoVideo as Record<string, unknown>;
        setPromoVideo({
          url: String(pv.url || ""),
          storagePath: pv.storagePath != null ? String(pv.storagePath) : null,
          type: pv.type === "embed" ? "embed" : "file",
        });
        if (pv.type === "embed") setPromoEmbedUrl(String(pv.url || ""));
      } else {
        setPromoVideo(null);
        setPromoEmbedUrl("");
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFile = async (kind: "hero" | "promo", file: File) => {
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
        setHeroImages((prev) => [
          ...prev,
          { url, storagePath, alt: "", order: prev.length },
        ]);
        toast({ title: "Obrázek nahrán", description: "Nezapomeňte uložit SEO." });
      } else {
        setPromoVideo({ type: "file", url, storagePath });
        setPromoEmbedUrl("");
        toast({ title: "Video nahráno", description: "Nezapomeňte uložit SEO." });
      }
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

  const removeHero = async (idx: number) => {
    const row = heroImages[idx];
    if (row?.storagePath) await deleteStoragePath(row.storagePath);
    setHeroImages((prev) => prev.filter((_, i) => i !== idx).map((h, i) => ({ ...h, order: i })));
  };

  const moveHero = (idx: number, dir: -1 | 1) => {
    setHeroImages((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((h, i) => ({ ...h, order: i }));
    });
  };

  const removePromo = async () => {
    if (promoVideo?.storagePath) await deleteStoragePath(promoVideo.storagePath);
    setPromoVideo(null);
    setPromoEmbedUrl("");
  };

  const applyEmbedUrl = () => {
    const u = promoEmbedUrl.trim();
    if (!u) {
      toast({ variant: "destructive", title: "Vložte URL videa (YouTube)." });
      return;
    }
    setPromoVideo({ type: "embed", url: u, storagePath: null });
    toast({ title: "Odkaz nastaven", description: "Uložte SEO pro zápis do databáze." });
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
          heroImages,
          promoVideo,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Uložení se nezdařilo.");
      }
      toast({ title: "SEO uloženo", description: "Metadata a média byla aktualizována." });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">SEO</h1>
        <p className="mt-1 text-slate-800">
          Meta tagy, texty a média pro veřejnou úvodní stránku (pouze superadmin; čtení veřejně přes API).
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Hlavní stránka — texty</CardTitle>
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
                <Label>Úvodní odstavec (landing)</Label>
                <Textarea
                  value={landingLead}
                  onChange={(e) => setLandingLead(e.target.value)}
                  rows={2}
                  className="bg-white"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Hero obrázky (veřejná stránka)</CardTitle>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept={HERO_ACCEPT}
              className="hidden"
              id="hero-upload"
              disabled={!!uploading || loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadFile("hero", f);
              }}
            />
            <Button type="button" variant="outline" size="sm" asChild disabled={!!uploading || loading}>
              <label htmlFor="hero-upload" className="cursor-pointer">
                {uploading === "hero" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Nahrát obrázek"}
              </label>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            JPG, PNG nebo WebP. Doporučeno alespoň 3 obrázky pro slider na úvodní stránce. Pořadí změníte šipkami;
            u každého obrázku vyplňte alt text (SEO).
          </p>
          {heroImages.length === 0 ? (
            <p className="text-sm text-slate-500">Zatím žádné obrázky.</p>
          ) : (
            <div className="space-y-4">
              {heroImages.map((h, idx) => (
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
                        setHeroImages((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, alt: v } : x))
                        );
                      }}
                      placeholder="Stručný popis obrázku"
                    />
                    <p className="truncate text-xs text-slate-500">{h.url}</p>
                  </div>
                  <div className="flex flex-row gap-1 sm:flex-col">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Výš"
                      disabled={idx === 0}
                      onClick={() => moveHero(idx, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Níž"
                      disabled={idx >= heroImages.length - 1}
                      onClick={() => moveHero(idx, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="text-red-700"
                      aria-label="Smazat"
                      onClick={() => void removeHero(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Video upoutávka</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-2xl">
          <p className="text-sm text-slate-600">
            Nahrajte MP4/WebM do úložiště, nebo vložte odkaz na YouTube. Jen jedno video je aktivní — nahrání
            souboru nahradí odkaz a naopak.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[200px] flex-1 space-y-1">
              <Label>Odkaz na video (YouTube)</Label>
              <Input
                className="bg-white"
                value={promoEmbedUrl}
                onChange={(e) => setPromoEmbedUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
              />
            </div>
            <Button type="button" variant="secondary" onClick={applyEmbedUrl}>
              Použít odkaz
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept={PROMO_ACCEPT}
              className="hidden"
              id="promo-upload"
              disabled={!!uploading || loading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadFile("promo", f);
              }}
            />
            <Button type="button" variant="outline" asChild disabled={!!uploading || loading}>
              <label htmlFor="promo-upload" className="cursor-pointer">
                {uploading === "promo" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Nahrát video (MP4/WebM)"}
              </label>
            </Button>
            {promoVideo ? (
              <Button type="button" variant="destructive" onClick={() => void removePromo()}>
                Odstranit video
              </Button>
            ) : null}
          </div>
          {promoVideo ? (
            <div className="rounded-md border border-slate-200 bg-slate-900 p-2 text-xs text-slate-200">
              <p className="font-medium text-white">Aktivní: {promoVideo.type === "embed" ? "odkaz" : "soubor"}</p>
              <p className="mt-1 break-all opacity-90">{promoVideo.url}</p>
            </div>
          ) : null}
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
