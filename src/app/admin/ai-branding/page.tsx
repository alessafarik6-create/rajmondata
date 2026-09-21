"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AiAssistantAvatar } from "@/components/ai/ai-assistant-avatar";
import { PlatformAiBrandingProvider } from "@/contexts/platform-ai-branding-context";

function AdminAiBrandingInner() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assistantName, setAssistantName] = useState("");
  const [assistantSubtitle, setAssistantSubtitle] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/ai-branding", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Načtení selhalo");
      setAssistantName(data.branding?.assistantName ?? "");
      setAssistantSubtitle(data.branding?.assistantSubtitle ?? "");
      setAvatarUrl(data.branding?.avatarUrl ?? null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Načtení selhalo",
      });
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
      const res = await fetch("/api/superadmin/ai-branding", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantName, assistantSubtitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Uložení selhalo");
      toast({ title: "Uloženo", description: "Branding AI sekretářky aktualizován." });
      await load();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení selhalo",
      });
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/superadmin/ai-branding-upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload selhal");
      setAvatarUrl(data.avatarUrl ?? null);
      toast({ title: "Avatar nahrán" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Upload",
        description: e instanceof Error ? e.message : "Selhalo",
      });
    } finally {
      setUploading(false);
    }
  };

  const resetAvatar = async () => {
    setSaving(true);
    try {
      await fetch("/api/superadmin/ai-branding", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetAvatar: true }),
      });
      setAvatarUrl(null);
      toast({ title: "Výchozí avatar obnoven" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI RAJMONDATA</h1>
        <p className="text-slate-700 text-sm mt-1">
          Globální maskot a texty firemní sekretářky (všechny organizace).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Maskot AI sekretářky</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <>
              <div className="flex items-center gap-4">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
                ) : (
                  <AiAssistantAvatar size="md" />
                )}
              </div>
              <div className="space-y-1">
                <Label>Název</Label>
                <Input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Podtitulek</Label>
                <Input
                  value={assistantSubtitle}
                  onChange={(e) => setAssistantSubtitle(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Label className="w-full">Nahrát nový obrázek (PNG/JPG/WebP, max 2 MB, 1:1)</Label>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void resetAvatar()}>
                  Obnovit výchozí avatar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminAiBrandingPage() {
  return (
    <PlatformAiBrandingProvider>
      <AdminAiBrandingInner />
    </PlatformAiBrandingProvider>
  );
}
