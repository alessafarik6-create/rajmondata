"use client";

import React, { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { COMPANIES_COLLECTION, ORGANIZATIONS_COLLECTION } from "@/lib/firestore-collections";
import {
  readInquiryEmailIdentity,
  type InquiryEmailIdentity,
} from "@/lib/inquiry-offer-email";
import {
  INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR,
  validateOfferCopyEmailsRaw,
} from "@/lib/inquiry-offer-copy";

const VAR_HINT =
  "Proměnné v šablonách nabídek: {jmeno}, {email}, {telefon}, {adresa}, {typ_poptavky}, {zprava}, {cena}, {firma}, {datum}";

type Props = {
  companyId: string;
  company: Record<string, unknown> | null | undefined;
};

export function InquiryEmailIdentitySettingsCard({ companyId, company }: Props) {
  const firestore = useFirestore();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [offerReplyEmail, setOfferReplyEmail] = useState("");
  const [offerCopyEmails, setOfferCopyEmails] = useState("");
  const [phone, setPhone] = useState("");
  const [web, setWeb] = useState("");
  const [emailSignatureHtml, setEmailSignatureHtml] = useState("");
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  useEffect(() => {
    const id = readInquiryEmailIdentity(company ?? undefined);
    setDisplayName(id.displayName ?? "");
    setContactEmail(id.contactEmail ?? String(company?.email ?? "").trim());
    setSenderEmail(id.senderEmail ?? "");
    setReplyToEmail(id.replyToEmail ?? "");
    setOfferReplyEmail(id.offerReplyEmail ?? "");
    setOfferCopyEmails(id.offerCopyEmails ?? "");
    setPhone(id.phone ?? String(company?.phone ?? "").trim());
    setWeb(id.web ?? String(company?.web ?? "").trim());
    setEmailSignatureHtml(id.emailSignatureHtml ?? "");
    const smtp = id.smtp;
    setSmtpEnabled(smtp?.enabled === true);
    setSmtpHost(smtp?.host ?? "");
    setSmtpPort(smtp?.port != null ? String(smtp.port) : "587");
    setSmtpSecure(smtp?.secure === true);
    setSmtpUser(smtp?.user ?? "");
    setSmtpPassword(smtp?.password ?? "");
  }, [company]);

  const buildPayload = (): InquiryEmailIdentity => ({
    displayName: displayName.trim() || null,
    contactEmail: contactEmail.trim() || null,
    senderEmail: senderEmail.trim() || null,
    replyToEmail: replyToEmail.trim() || null,
    offerReplyEmail: offerReplyEmail.trim() || null,
    offerCopyEmails: offerCopyEmails.trim() || null,
    phone: phone.trim() || null,
    web: web.trim() || null,
    emailSignatureHtml: emailSignatureHtml.trim() || null,
    smtp: {
      enabled: smtpEnabled,
      host: smtpHost.trim() || null,
      port: Number(smtpPort) || 587,
      secure: smtpSecure,
      user: smtpUser.trim() || null,
      password: smtpPassword || null,
    },
  });

  const handleSave = async () => {
    if (!firestore || !companyId) return;
    const copyCheck = validateOfferCopyEmailsRaw(offerCopyEmails);
    if (!copyCheck.ok) {
      toast({
        variant: "destructive",
        title: "Neplatné kopie nabídek",
        description: INQUIRY_OFFER_INVALID_COPY_EMAILS_ERROR,
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        inquiryEmailIdentity: buildPayload(),
        updatedAt: serverTimestamp(),
      };
      await Promise.all([
        setDoc(doc(firestore, COMPANIES_COLLECTION, companyId), payload, { merge: true }),
        setDoc(doc(firestore, ORGANIZATIONS_COLLECTION, companyId), payload, { merge: true }),
      ]);
      toast({ title: "Uloženo", description: "E-mailová identita organizace byla aktualizována." });
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
    <Card className="border-border">
      <CardHeader>
        <CardTitle>E-mailový podpis a identita</CardTitle>
        <CardDescription>
          Nabídky k poptávkám vypadají jako e-maily vaší organizace. Odpovědi zákazníka směřují na
          reply-to organizace, ne na platformu.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{VAR_HINT}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="inq-org-name">Název organizace pro e-maily</Label>
            <Input
              id="inq-org-name"
              className="w-full"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Např. Kovokan s.r.o."
            />
          </div>
          <EmailField id="inq-contact" label="Hlavní kontaktní e-mail" value={contactEmail} onChange={setContactEmail} />
          <EmailField id="inq-sender" label="E-mail odesílatele" value={senderEmail} onChange={setSenderEmail} />
          <EmailField id="inq-reply" label="Reply-to e-mail" value={replyToEmail} onChange={setReplyToEmail} />
          <EmailField
            id="inq-offer-reply"
            label="E-mail pro odpovědi na nabídky"
            value={offerReplyEmail}
            onChange={setOfferReplyEmail}
            hint="Má prioritu před reply-to"
          />
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="inq-offer-copy">Kopie nabídek (BCC/CC)</Label>
            <Input
              id="inq-offer-copy"
              type="text"
              inputMode="email"
              className="w-full break-all"
              value={offerCopyEmails}
              onChange={(e) => setOfferCopyEmails(e.target.value)}
              placeholder="např. obchod@firma.cz, ucetni@firma.cz"
            />
            <p className="text-xs text-muted-foreground break-words">
              Na tyto adresy odejde automatická kopie každé odeslané nabídky (včetně příloh). Více
              adres oddělte čárkou. Preferovaně se použije skrytá kopie (BCC).
            </p>
          </div>
          <PhoneFieldRow value={phone} onChange={setPhone} />
          <WebFieldRow value={web} onChange={setWeb} />
          <SignatureFieldRow value={emailSignatureHtml} onChange={setEmailSignatureHtml} />
        </div>
        <Separator />
        <SmtpBlock
          enabled={smtpEnabled}
          onEnabledChange={setSmtpEnabled}
          host={smtpHost}
          onHostChange={setSmtpHost}
          port={smtpPort}
          onPortChange={setSmtpPort}
          secure={smtpSecure}
          onSecureChange={setSmtpSecure}
          user={smtpUser}
          onUserChange={setSmtpUser}
          password={smtpPassword}
          onPasswordChange={setSmtpPassword}
        />
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="min-h-11 w-full sm:w-auto"
        >
          {saving ? "Ukládám…" : "Uložit e-mailovou identitu"}
        </Button>
      </CardContent>
    </Card>
  );
}

function EmailField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type="email"
        className="w-full"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

function PhoneFieldRow(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="inq-phone">Telefon</Label>
      <Input id="inq-phone" className="w-full" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

function WebFieldRow(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="inq-web">Web</Label>
      <Input id="inq-web" className="w-full" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

function SignatureFieldRow(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2 md:col-span-2">
      <Label htmlFor="inq-sig">Podpis e-mailu (HTML povolen)</Label>
      <Textarea
        id="inq-sig"
        rows={4}
        className="w-full resize-y"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">Logo organizace se bere z pole Logo na dokladech výše.</p>
    </div>
  );
}

function SmtpBlock(props: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  host: string;
  onHostChange: (v: string) => void;
  port: string;
  onPortChange: (v: string) => void;
  secure: boolean;
  onSecureChange: (v: boolean) => void;
  user: string;
  onUserChange: (v: string) => void;
  password: string;
  onPasswordChange: (v: string) => void;
}) {
  return (
    <SmtpOuter>
      <SmtpHeaderRow enabled={props.enabled} onEnabledChange={props.onEnabledChange} />
      {props.enabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>SMTP host</Label>
            <Input className="w-full" value={props.host} onChange={(e) => props.onHostChange(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Port</Label>
            <Input className="w-full" value={props.port} onChange={(e) => props.onPortChange(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch checked={props.secure} onCheckedChange={props.onSecureChange} id="smtp-secure" />
            <Label htmlFor="smtp-secure">SSL / port 465</Label>
          </div>
          <div className="space-y-2">
            <Label>Uživatel SMTP</Label>
            <Input className="w-full" value={props.user} onChange={(e) => props.onUserChange(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Heslo SMTP</Label>
            <Input
              type="password"
              className="w-full"
              value={props.password}
              onChange={(e) => props.onPasswordChange(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
      ) : null}
    </SmtpOuter>
  );
}

function SmtpOuter({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-lg border border-border p-4">{children}</div>;
}

function SmtpHeaderRow(props: { enabled: boolean; onEnabledChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Vlastní SMTP organizace</p>
        <p className="text-xs text-muted-foreground">FROM a REPLY-TO z e-mailu organizace.</p>
      </div>
      <Switch checked={props.enabled} onCheckedChange={props.onEnabledChange} />
    </div>
  );
}
