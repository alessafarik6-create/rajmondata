"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPlatformSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [landingHeadline, setLandingHeadline] = useState("");
  const [landingSubline, setLandingSubline] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/superadmin/platform-settings", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (typeof data.landingHeadline === "string") setLandingHeadline(data.landingHeadline);
          if (typeof data.landingSubline === "string") setLandingSubline(data.landingSubline);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/platform-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          landingHeadline,
          landingSubline,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Uloženo", description: "Nastavení platformy bylo uloženo." });
    } catch {
      toast({ variant: "destructive", title: "Chyba při ukládání" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Nastavení platformy</h1>
        <p className="mt-1 text-slate-600">Texty pro veřejnou úvodní stránku (headline, popis).</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Úvodní stránka</CardTitle>
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
                <Label>Headline</Label>
                <Input value={landingHeadline} onChange={(e) => setLandingHeadline(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Podnadpis</Label>
                <Input value={landingSubline} onChange={(e) => setLandingSubline(e.target.value)} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
