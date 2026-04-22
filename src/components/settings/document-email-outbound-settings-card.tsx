"use client";

import React, { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  DOCUMENT_EMAIL_TYPE_LABELS,
  type DocumentEmailType,
  DOCUMENT_EMAIL_TYPES,
  getEmailTemplate,
  readDocumentEmailOutbound,
  type DocumentEmailOutboundSettings,
} from "@/lib/document-email-outbound";

const TYPES: DocumentEmailType[] = [...DOCUMENT_EMAIL_TYPES];

const VAR_HINT =
  "Proměnné: {{nazev_firmy}}, {{jmeno_zakaznika}}, {{cislo_dokladu}}, {{datum}}, {{castka}}, {{odkaz_na_dokument}}";

type Props = {
  companyId: string;
  company: Record<string, unknown> | null | undefined;
};

export function DocumentEmailOutboundSettingsCard({ companyId, company }: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [autoCcOrg, setAutoCcOrg] = useState(false);
  const [ccEmails, setCcEmails] = useState("");
  const [tpl, setTpl] = useState<
    Record<DocumentEmailType, { subject: string; body: string }>
  >({
    contract: { subject: "", body: "" },
    invoice: { subject: "", body: "" },
    advance_invoice: { subject: "", body: "" },
    received_document: { subject: "", body: "" },
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const o = readDocumentEmailOutbound(company ?? undefined);
    setAutoCcOrg(Boolean(o.autoCcOrganizationEmail));
    setCcEmails(String(o.ccEmails ?? ""));
    const next = {} as Record<DocumentEmailType, { subject: string; body: string }>;
    for (const t of TYPES) {
      next[t] = getEmailTemplate(o, t);
    }
    setTpl(next);
  }, [company]);

  const updateTpl = (type: DocumentEmailType, field: "subject" | "body", v: string) => {
    setTpl((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: v },
    }));
  };

  const handleSave = async () => {
    if (!companyId || !firestore) return;
    const outbound: DocumentEmailOutboundSettings = {
      autoCcOrganizationEmail: autoCcOrg,
      ccEmails: ccEmails.trim() || null,
      templates: {
        contract: { subject: tpl.contract.subject, body: tpl.contract.body },
        invoice: { subject: tpl.invoice.subject, body: tpl.invoice.body },
        advance_invoice: {
          subject: tpl.advance_invoice.subject,
          body: tpl.advance_invoice.body,
        },
        received_document: {
          subject: tpl.received_document.subject,
          body: tpl.received_document.body,
        },
      },
    };
    const payload = { documentEmailOutbound: outbound, updatedAt: serverTimestamp() };
    try {
      setSaving(true);
      await Promise.all([
        setDoc(doc(firestore, COMPANIES_COLLECTION, companyId), payload, { merge: true }),
        setDoc(doc(firestore, ORGANIZATIONS_COLLECTION, companyId), payload, { merge: true }),
      ]);
      toast({ title: "Uloženo", description: "Šablony a kopie e-mailů byly aktualizovány." });
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

  return (
    <Card className="bg-surface border-border">
      <CardHeader>
        <CardTitle>E-mailové šablony</CardTitle>
        <CardDescription>
          Odeslání smlouvy, faktury, zálohové faktury a přijatého dokladu — předmět a text zprávy.{" "}
          {VAR_HINT}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Label>Automaticky kopírovat na e-mail organizace</Label>
            <p className="text-xs text-muted-foreground">
              Použije pole „E-mail“ z profilu organizace (nastavení výše).
            </p>
          </div>
          <Switch checked={autoCcOrg} onCheckedChange={setAutoCcOrg} />
        </div>
        <div className="space-y-2">
          <Label>Další adresy pro kopii (CC)</Label>
          <Input
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            placeholder="ucetni@firma.cz, fakturace@firma.cz"
            className="bg-background"
          />
          <p className="text-xs text-muted-foreground">Oddělte čárkou nebo středníkem.</p>
        </div>

        <Separator />

        {TYPES.map((type) => (
          <div key={type} className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              {DOCUMENT_EMAIL_TYPE_LABELS[type]}
            </h3>
            <div className="space-y-2">
              <Label>Předmět</Label>
              <Input
                value={tpl[type].subject}
                onChange={(e) => updateTpl(type, "subject", e.target.value)}
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label>Text e-mailu</Label>
              <Textarea
                value={tpl[type].body}
                onChange={(e) => updateTpl(type, "body", e.target.value)}
                rows={6}
                className="bg-background font-mono text-xs"
              />
            </div>
          </div>
        ))}

        <Button type="button" onClick={() => void handleSave()} disabled={saving || !companyId}>
          {saving ? "Ukládám…" : "Uložit šablony a kopie"}
        </Button>
      </CardContent>
    </Card>
  );
}
