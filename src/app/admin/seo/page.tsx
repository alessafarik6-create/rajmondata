"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminSeoPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [keywords, setKeywords] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogDescription, setOgDescription] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [landingLead, setLandingLead] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/superadmin/seo", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (typeof data.metaTitle === "string") setMetaTitle(data.metaTitle);
          if (typeof data.metaDescription === "string") setMetaDescription(data.metaDescription);
          if (typeof data.keywords === "string") setKeywords(data.keywords);
          if (typeof data.ogTitle === "string") setOgTitle(data.ogTitle);
          if (typeof data.ogDescription === "string") setOgDescription(data.ogDescription);
          if (typeof data.canonicalUrl === "string") setCanonicalUrl(data.canonicalUrl);
          if (typeof data.landingLead === "string") setLandingLead(data.landingLead);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/seo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaTitle,
          metaDescription,
          keywords,
          ogTitle,
          ogDescription,
          canonicalUrl,
          landingLead,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "SEO uloženo", description: "Metadata byla aktualizována." });
    } catch {
      toast({ variant: "destructive", title: "Chyba při ukládání" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">SEO</h1>
        <p className="mt-1 text-slate-800">Meta tagy a texty pro veřejnou stránku.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Hlavní stránka</CardTitle>
          <Button type="button" onClick={save} disabled={saving || loading}>
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
                <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Meta description</Label>
                <Textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-1">
                <Label>Klíčová slova</Label>
                <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Open Graph title</Label>
                <Input value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Open Graph description</Label>
                <Textarea value={ogDescription} onChange={(e) => setOgDescription(e.target.value)} rows={2} />
              </div>
              <div className="space-y-1">
                <Label>Canonical URL</Label>
                <Input value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Úvodní odstavec (landing)</Label>
                <Textarea value={landingLead} onChange={(e) => setLandingLead(e.target.value)} rows={2} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
