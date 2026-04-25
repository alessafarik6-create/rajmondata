"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";

type FormState = {
  companyName: string;
  address: string;
  ico: string;
  dic: string;
  email: string;
  phone: string;
  accountNumber: string;
  iban: string;
  swift: string;
  logoUrl: string;
  stampUrl: string;
  invoiceFooterText: string;
};

const empty: FormState = {
  companyName: "",
  address: "",
  ico: "",
  dic: "",
  email: "",
  phone: "",
  accountNumber: "",
  iban: "",
  swift: "",
  logoUrl: "",
  stampUrl: "",
  invoiceFooterText: "",
};

export default function AdminBillingProviderPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [uploading, setUploading] = useState<"logo" | "stamp" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/billing-provider", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Načtení se nezdařilo.");
      const d = data as Record<string, unknown>;
      setForm({
        companyName: String(d.companyName ?? ""),
        address: String(d.address ?? ""),
        ico: String(d.ico ?? ""),
        dic: String(d.dic ?? ""),
        email: String(d.email ?? ""),
        phone: String(d.phone ?? ""),
        accountNumber: String(d.accountNumber ?? ""),
        iban: String(d.iban ?? ""),
        swift: String(d.swift ?? ""),
        logoUrl: String(d.logoUrl ?? ""),
        stampUrl: String(d.stampUrl ?? ""),
        invoiceFooterText: String(d.invoiceFooterText ?? ""),
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/superadmin/billing-provider", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          address: form.address,
          ico: form.ico,
          dic: form.dic,
          email: form.email,
          phone: form.phone,
          accountNumber: form.accountNumber,
          iban: form.iban,
          swift: form.swift,
          logoUrl: form.logoUrl || null,
          stampUrl: form.stampUrl || null,
          invoiceFooterText: form.invoiceFooterText,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Uložení se nezdařilo.");
      toast({ title: "Uloženo", description: "Fakturační údaje provozovatele byly aktualizovány." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Uložení se nezdařilo.",
      });
    } finally {
      setSaving(false);
    }
  };

  const uploadKind = async (kind: "logo" | "stamp", file: File | null) => {
    if (!file) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", file);
      const res = await fetch("/api/superadmin/billing-provider-upload", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Nahrání se nezdařilo.");
      const url = String(j.url || "");
      if (kind === "logo") setForm((f) => ({ ...f, logoUrl: url }));
      else setForm((f) => ({ ...f, stampUrl: url }));
      toast({ title: "Nahráno", description: kind === "logo" ? "Logo uloženo." : "Razítko / podpis uložen." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Nahrání se nezdařilo.",
      });
    } finally {
      setUploading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Provozovatel platformy / Fakturační údaje</h1>
        <p className="text-slate-600 mt-2 text-sm">
          Tyto údaje se použijí jako <strong>dodavatel</strong> na fakturách za používání platformy vystavených
          organizacím.
        </p>
      </div>

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle>Údaje na fakturu</CardTitle>
          <CardDescription>IČO, DIČ, adresa a platební spojení — musí být vyplněné pro korektní PDF a QR platbu.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Název firmy</Label>
              <Input
                className="bg-white"
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>IČO</Label>
              <Input className="bg-white" value={form.ico} onChange={(e) => setForm((f) => ({ ...f, ico: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>DIČ</Label>
              <Input className="bg-white" value={form.dic} onChange={(e) => setForm((f) => ({ ...f, dic: e.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Adresa (více řádků)</Label>
              <Textarea
                className="bg-white min-h-[88px]"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input
                className="bg-white"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Telefon</Label>
              <Input className="bg-white" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Číslo účtu (např. 123456789/0100)</Label>
              <Input
                className="bg-white"
                value={form.accountNumber}
                onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>IBAN (volitelné, doporučeno pro QR)</Label>
              <Input className="bg-white" value={form.iban} onChange={(e) => setForm((f) => ({ ...f, iban: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>SWIFT / BIC (volitelné)</Label>
              <Input className="bg-white" value={form.swift} onChange={(e) => setForm((f) => ({ ...f, swift: e.target.value }))} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 border-t border-slate-100 pt-4">
            <div className="space-y-2">
              <Label>Logo firmy (URL)</Label>
              <Input className="bg-white" value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="text-sm"
                  disabled={uploading !== null}
                  onChange={(e) => void uploadKind("logo", e.target.files?.[0] ?? null)}
                />
                {uploading === "logo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-slate-500" />}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Podpis / razítko (URL)</Label>
              <Input className="bg-white" value={form.stampUrl} onChange={(e) => setForm((f) => ({ ...f, stampUrl: e.target.value }))} />
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="text-sm"
                  disabled={uploading !== null}
                  onChange={(e) => void uploadKind("stamp", e.target.files?.[0] ?? null)}
                />
                {uploading === "stamp" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-slate-500" />}
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-4">
            <Label>Text patičky faktury</Label>
            <Textarea
              className="bg-white min-h-[100px]"
              value={form.invoiceFooterText}
              onChange={(e) => setForm((f) => ({ ...f, invoiceFooterText: e.target.value }))}
              placeholder="Společnost je plátcem DPH… / kontaktní údaje…"
            />
          </div>

          <Button type="button" onClick={() => void save()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Uložit
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
