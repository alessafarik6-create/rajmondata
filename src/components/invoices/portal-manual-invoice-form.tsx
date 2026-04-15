"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentData, UpdateData } from "firebase/firestore";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Save, Loader2, Calculator, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCollection, useMemoFirebase, useCompany } from "@/firebase";
import type { Firestore } from "firebase/firestore";
import { allocateNextDocumentNumber } from "@/lib/invoice-number-series";
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import { lookupCzechCompanyByIco } from "@/lib/company-lookup-api";
import { sendModuleEmailNotificationFromBrowser } from "@/lib/email-notifications/client";
import {
  type OrgBankAccountRow,
  resolvePaymentAccount,
} from "@/lib/invoice-billing-meta";
import {
  PORTAL_MANUAL_INVOICE_TYPE,
  type InvoiceRecipientSnapshot,
  type PortalInvoiceRecipientType,
  type PortalManualFormItem,
  invoiceRecipientFromCustomerDoc,
  mergeAresIntoRecipient,
  validateInvoiceRecipientSnapshot,
  buildPortalManualInvoiceHtml,
  scrubFirestoreValue,
  portalFormItemsForFirestore,
  parseInvoiceRecipientFromInvoiceDoc,
  recipientDisplayName,
  buildRecipientAddressMultiline,
} from "@/lib/portal-manual-invoice";

const DEFAULT_VAT = 21;

type Props = {
  firestore: Firestore;
  companyId: string;
  userId: string;
  mode: "create" | "edit";
  invoiceId?: string;
  initialInvoice?: Record<string, unknown> | null;
};

export function PortalManualInvoiceForm({
  firestore,
  companyId,
  userId,
  mode,
  invoiceId,
  initialInvoice,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const { company, companyName } = useCompany();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aresLoading, setAresLoading] = useState(false);

  const [jobId, setJobId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [recipient, setRecipient] = useState<InvoiceRecipientSnapshot>({
    type: "job_customer",
    name: "",
  });

  const [items, setItems] = useState<PortalManualFormItem[]>([
    { id: "1", description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split("T")[0];
  });
  const [taxSupplyDate, setTaxSupplyDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [bankAccountId, setBankAccountId] = useState<string>("");

  const { data: customersRaw } = useCollection(
    useMemoFirebase(
      () => collection(firestore, "companies", companyId, "customers"),
      [firestore, companyId]
    )
  );
  const customers = useMemo(() => (Array.isArray(customersRaw) ? customersRaw : []), [customersRaw]);

  const { data: jobsRaw } = useCollection(
    useMemoFirebase(
      () => collection(firestore, "companies", companyId, "jobs"),
      [firestore, companyId]
    )
  );
  const jobs = useMemo(() => {
    const rows = Array.isArray(jobsRaw) ? jobsRaw : [];
    return rows
      .map((j) => ({
        id: String((j as { id?: string }).id ?? ""),
        name: String((j as { name?: string }).name ?? "Zakázka").trim() || "Zakázka",
      }))
      .filter((j) => j.id);
  }, [jobsRaw]);

  const bankAccountsColRef = useMemoFirebase(
    () => collection(firestore, "companies", companyId, "bankAccounts"),
    [firestore, companyId]
  );
  const { data: bankAccountsRaw } = useCollection(bankAccountsColRef);
  const orgBankAccounts = useMemo(
    () => (Array.isArray(bankAccountsRaw) ? bankAccountsRaw : []) as OrgBankAccountRow[],
    [bankAccountsRaw]
  );

  const legacyCompanyBank = useMemo(() => {
    const c = company as { bankAccountNumber?: string } | null | undefined;
    return String(c?.bankAccountNumber ?? "").trim() || null;
  }, [company]);

  const supplierName = useMemo(
    () =>
      String((company as { companyName?: string })?.companyName ?? companyName ?? "").trim() ||
      "Dodavatel",
    [company, companyName]
  );

  const supplierAddressLines = useMemo(
    () => buildCustomerAddressMultiline(company),
    [company]
  );

  const supplierIco = useMemo(
    () => String((company as { ico?: string })?.ico ?? "").trim() || null,
    [company]
  );
  const supplierDic = useMemo(
    () => String((company as { dic?: string })?.dic ?? "").trim() || null,
    [company]
  );

  const logoUrl = useMemo(() => {
    const u = (company as { organizationLogoUrl?: string | null })?.organizationLogoUrl;
    return u && String(u).trim() ? String(u).trim() : null;
  }, [company]);

  const [initialized, setInitialized] = useState(mode === "create");

  useEffect(() => {
    if (mode !== "edit" || !initialInvoice || initialized) return;
    const inv = initialInvoice;
    const t = String(inv.type ?? "");
    if (t !== PORTAL_MANUAL_INVOICE_TYPE) {
      setInitialized(true);
      return;
    }
    setIssueDate(
      typeof inv.issueDate === "string" && inv.issueDate
        ? inv.issueDate.slice(0, 10)
        : new Date().toISOString().split("T")[0]
    );
    setDueDate(
      typeof inv.dueDate === "string" && inv.dueDate
        ? inv.dueDate.slice(0, 10)
        : new Date().toISOString().split("T")[0]
    );
    setTaxSupplyDate(
      typeof inv.taxSupplyDate === "string" && inv.taxSupplyDate
        ? inv.taxSupplyDate.slice(0, 10)
        : typeof inv.issueDate === "string" && inv.issueDate
          ? inv.issueDate.slice(0, 10)
          : new Date().toISOString().split("T")[0]
    );
    setNotes(String(inv.notes ?? ""));
    setJobId(typeof inv.jobId === "string" ? inv.jobId : "");
    setCustomerId(typeof inv.customerId === "string" ? inv.customerId : "");
    setBankAccountId(String(inv.bankAccountId ?? ""));

    const snap = parseInvoiceRecipientFromInvoiceDoc(inv);
    if (snap) setRecipient(snap);

    const rawItems = inv.items;
    if (Array.isArray(rawItems) && rawItems.length > 0) {
      setItems(
        rawItems.map((row: unknown, i: number) => {
          const r = row as Record<string, unknown>;
          return {
            id: String(r.id ?? `row-${i}`),
            description: String(r.description ?? ""),
            quantity: Number(r.quantity) || 0,
            unitPrice: Number(r.unitPrice) || 0,
          };
        })
      );
    }
    setInitialized(true);
  }, [mode, initialInvoice, initialized]);

  useEffect(() => {
    if (recipient.type !== "job_customer" || !customerId) return;
    const c = customers.find((x) => x.id === customerId);
    if (c) {
      setRecipient(invoiceRecipientFromCustomerDoc(customerId, c));
    }
  }, [recipient.type, customerId, customers]);

  const jobDisplayName = useMemo(() => {
    if (!jobId.trim()) return "—";
    const j = jobs.find((x) => x.id === jobId);
    return j?.name ?? "—";
  }, [jobId, jobs]);

  const setRecipientType = (t: PortalInvoiceRecipientType) => {
    setRecipient((prev) => {
      const base: InvoiceRecipientSnapshot = {
        ...prev,
        type: t,
      };
      if (t === "job_customer") {
        return customerId
          ? invoiceRecipientFromCustomerDoc(
              customerId,
              customers.find((x) => x.id === customerId) ?? null
            )
          : { type: "job_customer", name: "" };
      }
      if (t === "company_by_ic") {
        return {
          type: "company_by_ic",
          name: base.name || "",
          companyName: base.companyName ?? null,
          ico: base.ico ?? null,
          dic: base.dic ?? null,
          street: base.street ?? null,
          city: base.city ?? null,
          postalCode: base.postalCode ?? null,
          country: base.country ?? "Česká republika",
          email: base.email ?? null,
          phone: base.phone ?? null,
        };
      }
      return {
        type: "manual",
        name: base.name || "",
        companyName: base.companyName ?? null,
        ico: base.ico ?? null,
        dic: base.dic ?? null,
        street: base.street ?? null,
        city: base.city ?? null,
        postalCode: base.postalCode ?? null,
        country: base.country ?? "Česká republika",
        email: base.email ?? null,
        phone: base.phone ?? null,
        recipientNote: base.recipientNote ?? null,
      };
    });
  };

  const handleAresLookup = async () => {
    const icoRaw = String(recipient.ico ?? "").replace(/\D/g, "").slice(0, 8);
    setAresLoading(true);
    try {
      const results = await lookupCzechCompanyByIco(icoRaw);
      const first = results[0];
      if (!first) {
        toast({ variant: "destructive", title: "Nenalezeno", description: "ARES nevrátil žádný záznam." });
        return;
      }
      setRecipient((prev) => mergeAresIntoRecipient({ ...prev, type: "company_by_ic" }, first));
      toast({ title: "Údaje z ARES načteny", description: `Vyplněno pro IČO ${first.ico}. Údaje můžete upravit.` });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Vyhledání v ARES",
        description: e instanceof Error ? e.message : "Zkuste údaje doplnit ručně.",
      });
    } finally {
      setAresLoading(false);
    }
  };

  const addItem = () => {
    setItems((prev) => [...prev, { id: Math.random().toString(36).slice(2), description: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== id)));
  };

  const updateItem = (id: string, patch: Partial<PortalManualFormItem>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const totalAmount = useMemo(
    () => items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0),
    [items]
  );

  const persistInvoice = async () => {
    const err = validateInvoiceRecipientSnapshot(
      recipient,
      recipient.type === "job_customer" ? customerId : ""
    );
    if (err) {
      toast({ variant: "destructive", title: "Odběratel", description: err });
      return;
    }

    let invoiceNumberStr: string;
    if (mode === "edit" && initialInvoice) {
      invoiceNumberStr = String((initialInvoice as { invoiceNumber?: string }).invoiceNumber ?? "").trim();
      if (!invoiceNumberStr) {
        toast({ variant: "destructive", title: "Chyba", description: "Faktuře chybí číslo dokladu." });
        return;
      }
    } else {
      invoiceNumberStr = await allocateNextDocumentNumber(firestore, companyId, "FA");
    }

    let built: ReturnType<typeof buildPortalManualInvoiceHtml>;
    try {
      built = buildPortalManualInvoiceHtml({
        invoiceNumber: invoiceNumberStr,
        issueDate,
        dueDate,
        taxSupplyDate,
        jobName: jobDisplayName,
        notes: notes || null,
        recipient,
        supplierName,
        supplierAddressLines,
        supplierIco,
        supplierDic,
        logoUrl,
        items,
        orgBankAccounts,
        overrideBankAccountId: bankAccountId.trim() || null,
        legacyCompanyBankLine: legacyCompanyBank,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nelze sestavit fakturu",
        description: e instanceof Error ? e.message : "Zkontrolujte položky.",
      });
      return;
    }

    const { html, amountNet, vatAmount, amountGross, variableSymbol } = built;
    const bankSnap = resolvePaymentAccount({
      bankAccounts: orgBankAccounts,
      overrideBankAccountId: bankAccountId.trim() || null,
      contract: null,
      job: null,
      legacyCompanyBankLine: legacyCompanyBank,
    });
    const displayName = recipientDisplayName(recipient);
    const addrLines = buildRecipientAddressMultiline(recipient);

    const basePayload = scrubFirestoreValue({
      type: PORTAL_MANUAL_INVOICE_TYPE,
      organizationId: companyId,
      companyId,
      jobId: jobId.trim() || null,
      customerId: recipient.type === "job_customer" ? customerId.trim() || null : null,
      invoiceRecipient: scrubFirestoreValue({
        type: recipient.type,
        name: recipient.name,
        companyName: recipient.companyName ?? null,
        ico: recipient.ico ?? null,
        dic: recipient.dic ?? null,
        street: recipient.street ?? null,
        city: recipient.city ?? null,
        postalCode: recipient.postalCode ?? null,
        country: recipient.country ?? null,
        email: recipient.email ?? null,
        phone: recipient.phone ?? null,
        recipientNote: recipient.recipientNote ?? null,
        sourceCustomerId: recipient.sourceCustomerId ?? null,
      }),
      customerName: displayName,
      customerAddressLines: addrLines || displayName,
      customerPhone: recipient.phone ?? null,
      customerEmail: recipient.email ?? null,
      customerIco: recipient.ico ?? null,
      customerDic: recipient.dic ?? null,
      invoiceNumber: invoiceNumberStr,
      items: portalFormItemsForFirestore(items),
      totalAmount: amountGross,
      amountNet,
      vatAmount,
      amountGross,
      vat: DEFAULT_VAT,
      vatRate: DEFAULT_VAT,
      variableSymbol,
      pdfHtml: html,
      issueDate,
      dueDate,
      taxSupplyDate,
      notes: notes.trim() || null,
      status: (initialInvoice as { status?: string })?.status ?? "draft",
      issueStatus: "issued",
      isDeleted: false,
      updatedAt: serverTimestamp(),
      bankAccountId: bankSnap.bankAccountId,
      bankAccountNumber: bankSnap.bankAccountNumber,
      bankCode: bankSnap.bankCode,
      iban: bankSnap.iban,
      swift: bankSnap.swift,
    }) as Record<string, unknown>;

    if (mode === "edit" && invoiceId) {
      await updateDoc(
        doc(firestore, "companies", companyId, "invoices", invoiceId),
        basePayload as UpdateData<DocumentData>
      );
      toast({ title: "Faktura uložena", description: "Změny včetně náhledu byly uloženy." });
      router.push(`/portal/invoices/${invoiceId}`);
      return;
    }

    basePayload.createdAt = serverTimestamp();
    basePayload.createdBy = userId;

    const invRef = await addDoc(collection(firestore, "companies", companyId, "invoices"), basePayload);

    const recipientLine =
      [
        recipient.companyName?.trim(),
        recipient.name?.trim(),
        recipient.email?.trim(),
      ]
        .find(Boolean) ?? "";
    void sendModuleEmailNotificationFromBrowser({
      companyId,
      module: "invoices",
      eventKey: "newInvoice",
      entityId: invRef.id,
      title: `Nová faktura: ${invoiceNumberStr}`,
      lines: [`Částka: ${amountGross} Kč`, recipientLine ? `Odběratel: ${recipientLine}` : ""].filter(Boolean),
      actionPath: `/portal/invoices/${invRef.id}`,
    });

    await addDoc(collection(firestore, "companies", companyId, "finance"), {
      amount: amountGross,
      type: "revenue",
      date: issueDate,
      description: `Faktura ${invoiceNumberStr}`,
      createdAt: serverTimestamp(),
    });

    toast({ title: "Faktura vytvořena", description: `Uloženo jako ${invoiceNumberStr}.` });
    router.push(`/portal/invoices/${invRef.id}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await persistInvoice();
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Chyba při ukládání",
        description: error instanceof Error ? error.message : "Zkuste to znovu.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!initialized) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle>Odběratel faktury</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Typ odběratele</Label>
            <Select
              value={recipient.type}
              onValueChange={(v) => setRecipientType(v as PortalInvoiceRecipientType)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="job_customer">Zákazník ze seznamu</SelectItem>
                <SelectItem value="company_by_ic">Firma podle IČ (ARES)</SelectItem>
                <SelectItem value="manual">Jiná osoba / ruční zadání</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Vazba na zakázku (nepovinná)</Label>
            <Select value={jobId || "__none__"} onValueChange={(v) => setJobId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Bez vazby na zakázku" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Bez zakázky</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Faktura může být navázaná na zakázku, ale odběratel může být jiný subjekt než zákazník u zakázky.
            </p>
          </div>

          {recipient.type === "job_customer" ? (
            <div className="space-y-2">
              <Label>Zákazník</Label>
              <Select
                value={customerId || "__none__"}
                onValueChange={(v) => setCustomerId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Vyberte zákazníka" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— vyberte —</SelectItem>
                  {customers.map((c) => {
                    const row = c as Record<string, unknown>;
                    const label =
                      String(row.companyName ?? "").trim() ||
                      `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() ||
                      c.id;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Údaje se předvyplní ze zákaznického záznamu; po uložení zůstanou na faktuře jako snapshot.
              </p>
            </div>
          ) : null}

          {recipient.type === "company_by_ic" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label>IČO</Label>
                <Input
                  className="bg-background"
                  value={recipient.ico ?? ""}
                  onChange={(e) =>
                    setRecipient((p) => ({
                      ...p,
                      ico: e.target.value.replace(/\D/g, "").slice(0, 8) || null,
                    }))
                  }
                  placeholder="12345678"
                  maxLength={8}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={aresLoading}
                onClick={() => void handleAresLookup()}
              >
                {aresLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Vyhledat v ARES
              </Button>
            </div>
          ) : null}

          {(recipient.type === "company_by_ic" || recipient.type === "manual") && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2 space-y-2">
                <Label>Název / jméno</Label>
                <Input
                  className="bg-background"
                  value={recipient.name}
                  onChange={(e) => setRecipient((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              {recipient.type === "manual" ? (
                <div className="md:col-span-2 space-y-2">
                  <Label>Název firmy (nepovinné)</Label>
                  <Input
                    className="bg-background"
                    value={recipient.companyName ?? ""}
                    onChange={(e) =>
                      setRecipient((p) => ({ ...p, companyName: e.target.value || null }))
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>IČO</Label>
                <Input
                  className="bg-background"
                  value={recipient.ico ?? ""}
                  onChange={(e) =>
                    setRecipient((p) => ({ ...p, ico: e.target.value.replace(/\D/g, "").slice(0, 8) || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>DIČ</Label>
                <Input
                  className="bg-background"
                  value={recipient.dic ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, dic: e.target.value.trim() || null }))}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Ulice a číslo</Label>
                <Input
                  className="bg-background"
                  value={recipient.street ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, street: e.target.value || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Město</Label>
                <Input
                  className="bg-background"
                  value={recipient.city ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, city: e.target.value || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>PSČ</Label>
                <Input
                  className="bg-background"
                  value={recipient.postalCode ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, postalCode: e.target.value || null }))}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Stát</Label>
                <Input
                  className="bg-background"
                  value={recipient.country ?? ""}
                  onChange={(e) =>
                    setRecipient((p) => ({ ...p, country: e.target.value.trim() || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input
                  className="bg-background"
                  type="email"
                  value={recipient.email ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, email: e.target.value.trim() || null }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefon</Label>
                <Input
                  className="bg-background"
                  value={recipient.phone ?? ""}
                  onChange={(e) => setRecipient((p) => ({ ...p, phone: e.target.value.trim() || null }))}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <Label>Poznámka k odběrateli</Label>
                <Textarea
                  className="bg-background"
                  rows={2}
                  value={recipient.recipientNote ?? ""}
                  onChange={(e) =>
                    setRecipient((p) => ({ ...p, recipientNote: e.target.value.trim() || null }))
                  }
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-surface border-border">
        <CardHeader>
          <CardTitle>Údaje faktury</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Datum vystavení</Label>
            <Input type="date" className="bg-background" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Datum zdanitelného plnění</Label>
            <Input
              type="date"
              className="bg-background"
              value={taxSupplyDate}
              onChange={(e) => setTaxSupplyDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Splatnost</Label>
            <Input type="date" className="bg-background" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Bankovní účet (pro QR)</Label>
            <Select
              value={bankAccountId || "__default__"}
              onValueChange={(v) => setBankAccountId(v === "__default__" ? "" : v)}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Výchozí účet firmy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Výchozí / dle firmy</SelectItem>
                {orgBankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {(a.name || "").trim() || a.accountNumber || a.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Poznámka na faktuře</Label>
            <Textarea className="bg-background" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {mode === "create" ? (
            <div className="md:col-span-2 space-y-2">
              <Label>Číslo faktury</Label>
              <Input readOnly className="bg-muted text-muted-foreground" value="Přidělí se automaticky (řada FA-ROK-###)" />
            </div>
          ) : (
            <div className="md:col-span-2 space-y-2">
              <Label>Číslo faktury</Label>
              <Input
                readOnly
                className="bg-muted"
                value={String((initialInvoice as { invoiceNumber?: string })?.invoiceNumber ?? "")}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-surface border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Položky faktury</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-2">
            <Plus className="h-4 w-4" /> Přidat řádek
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Cena za jednotku je včetně DPH (21 %), stejně jako dříve u této šablony.
          </p>
          <div className="hidden px-2 text-xs font-bold uppercase text-muted-foreground md:grid md:grid-cols-12 md:gap-4">
            <div className="col-span-6">Popis</div>
            <div className="col-span-2">Množství</div>
            <div className="col-span-3">Cena za jedn. vč. DPH (Kč)</div>
            <div className="col-span-1" />
          </div>
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-1 items-center gap-4 md:grid-cols-12">
              <div className="col-span-6">
                <Input
                  placeholder="Popis služby / zboží"
                  className="bg-background"
                  value={item.description}
                  onChange={(e) => updateItem(item.id, { description: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  className="bg-background"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.id, { quantity: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  className="bg-background"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.id, { unitPrice: Number(e.target.value) })}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(item.id)}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
        <Separator />
        <CardFooter className="flex flex-col items-end py-6">
          <p className="text-sm text-muted-foreground">
            Celkem bez DPH: {Math.round(totalAmount / 1.21).toLocaleString("cs-CZ")} Kč
          </p>
          <p className="flex items-center gap-2 text-2xl font-bold text-primary">
            <Calculator className="h-6 w-6" /> {totalAmount.toLocaleString("cs-CZ")} Kč
          </p>
          <p className="text-xs italic text-muted-foreground">Včetně DPH {DEFAULT_VAT} %</p>
        </CardFooter>
      </Card>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(mode === "edit" && invoiceId ? `/portal/invoices/${invoiceId}` : "/portal/documents?view=issued")
          }
        >
          Zrušit
        </Button>
        <Button type="submit" disabled={isSubmitting} className="gap-2 px-8">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {mode === "edit" ? "Uložit změny" : "Uložit fakturu"}
        </Button>
      </div>
    </form>
  );
}
