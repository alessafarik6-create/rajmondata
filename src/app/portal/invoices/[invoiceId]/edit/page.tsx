"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc } from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCompany,
} from "@/firebase";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import {
  invoiceItemsToManualLines,
  JOB_INVOICE_TYPES,
  updateAdvanceInvoiceItems,
  type ManualAdvanceLineInput,
} from "@/lib/job-billing-invoices";
import { normalizeVatRate } from "@/lib/vat-calculations";
import { useToast } from "@/hooks/use-toast";

const VAT_OPTIONS = [0, 12, 21] as const;

export default function EditAdvanceInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = typeof params?.invoiceId === "string" ? params.invoiceId : "";
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const { company, companyName, isLoading: companyLoading } = useCompany();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = profile?.companyId as string | undefined;

  const invoiceRef = useMemoFirebase(
    () =>
      firestore && companyId && invoiceId
        ? doc(firestore, "companies", companyId, "invoices", invoiceId)
        : null,
    [firestore, companyId, invoiceId]
  );
  const { data: invoice, isLoading: invoiceLoading } = useDoc(invoiceRef);

  const jobId = invoice && typeof (invoice as { jobId?: string }).jobId === "string"
    ? (invoice as { jobId: string }).jobId
    : "";
  const customerId =
    invoice && typeof (invoice as { customerId?: string }).customerId === "string"
      ? (invoice as { customerId: string }).customerId
      : "";

  const jobRef = useMemoFirebase(
    () =>
      firestore && companyId && jobId
        ? doc(firestore, "companies", companyId, "jobs", jobId)
        : null,
    [firestore, companyId, jobId]
  );
  const { data: jobDoc } = useDoc(jobRef);

  const customerRef = useMemoFirebase(
    () =>
      firestore && companyId && customerId
        ? doc(firestore, "companies", companyId, "customers", customerId)
        : null,
    [firestore, companyId, customerId]
  );
  const { data: customerDoc } = useDoc(customerRef);

  const [lines, setLines] = useState<ManualAdvanceLineInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const jobName = useMemo(() => {
    const j = jobDoc as Record<string, unknown> | null | undefined;
    return String(j?.name ?? j?.title ?? "Zakázka").trim() || "Zakázka";
  }, [jobDoc]);

  const customerName = useMemo(() => {
    const inv = invoice as Record<string, unknown> | null | undefined;
    return String(inv?.customerName ?? "").trim() || "Odběratel";
  }, [invoice]);

  const customerAddressLines = useMemo(() => {
    const fromCustomer = buildCustomerAddressMultiline(customerDoc);
    if (fromCustomer.trim()) return fromCustomer;
    return customerName;
  }, [customerDoc, customerName]);

  const supplierName = useMemo(() => {
    return (
      String((company as { companyName?: string })?.companyName ?? companyName ?? "").trim() ||
      "Dodavatel"
    );
  }, [company, companyName]);

  const supplierAddressLines = useMemo(
    () => buildCustomerAddressMultiline(company),
    [company]
  );

  const logoUrl = useMemo(() => {
    const u = (company as { organizationLogoUrl?: string | null })?.organizationLogoUrl;
    return u && String(u).trim() ? String(u).trim() : null;
  }, [company]);

  useEffect(() => {
    if (!invoice || initialized) return;
    const inv = invoice as Record<string, unknown>;
    if (String(inv.type ?? "") !== JOB_INVOICE_TYPES.ADVANCE) return;
    setLines(invoiceItemsToManualLines(inv));
    setInitialized(true);
  }, [invoice, initialized]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { description: "", quantity: 1, unit: "ks", unitPriceNet: 0, vatRate: 21 },
    ]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, patch: Partial<ManualAdvanceLineInput>) => {
    setLines((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const handleSave = async () => {
    if (!user || !companyId || !invoiceId) return;
    setSaving(true);
    try {
      await updateAdvanceInvoiceItems({
        firestore,
        companyId,
        invoiceId,
        jobName,
        customerName,
        customerAddressLines: customerAddressLines || customerName,
        supplierName,
        supplierAddressLines: supplierAddressLines || supplierName,
        userId: user.uid,
        logoUrl,
        lines,
      });
      toast({ title: "Uloženo", description: "Položky a náhled dokladu byly aktualizovány." });
      router.push(`/portal/invoices/${invoiceId}`);
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

  if (profileLoading || companyLoading || (companyId && invoiceLoading)) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Firma</AlertTitle>
        <AlertDescription>Doklad nelze upravit.</AlertDescription>
      </Alert>
    );
  }

  if (!invoice) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Doklad nebyl nalezen</AlertTitle>
        <AlertDescription>
          <Link href="/portal/invoices" className="underline">
            Zpět na faktury
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (String((invoice as { type?: string }).type ?? "") !== JOB_INVOICE_TYPES.ADVANCE) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Úprava není k dispozici</AlertTitle>
        <AlertDescription>
          Položky lze měnit jen u zálohové faktury.{" "}
          <Link href={`/portal/invoices/${invoiceId}`} className="underline">
            Zpět na doklad
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-2 pb-10 sm:px-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/portal/invoices/${invoiceId}`} aria-label="Zpět">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">Upravit zálohovou fakturu</h1>
      </div>

      <p className="text-sm text-neutral-700">
        Zakázka: <strong>{jobName}</strong> · Odběratel: <strong>{customerName}</strong>
      </p>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Položky</h2>
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addLine}>
            <Plus className="h-4 w-4" />
            Přidat řádek
          </Button>
        </div>

        <div className="space-y-4">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="grid gap-3 rounded-md border border-neutral-100 p-3 sm:grid-cols-2 lg:grid-cols-12"
            >
              <div className="sm:col-span-2 lg:col-span-5">
                <Label>Popis</Label>
                <Input
                  value={line.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  className="border-neutral-950"
                />
              </div>
              <div className="lg:col-span-2">
                <Label>Množství</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) =>
                    updateLine(idx, { quantity: Number(e.target.value.replace(",", ".")) || 0 })
                  }
                  className="border-neutral-950"
                />
              </div>
              <div className="lg:col-span-1">
                <Label>j.</Label>
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(idx, { unit: e.target.value })}
                  className="border-neutral-950"
                />
              </div>
              <div className="lg:col-span-2">
                <Label>Cena bez DPH (jednotková)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPriceNet}
                  onChange={(e) =>
                    updateLine(idx, {
                      unitPriceNet: Number(e.target.value.replace(",", ".")) || 0,
                    })
                  }
                  className="border-neutral-950"
                />
              </div>
              <div className="lg:col-span-2">
                <Label>DPH</Label>
                <Select
                  value={String(line.vatRate)}
                  onValueChange={(v) => updateLine(idx, { vatRate: normalizeVatRate(Number(v)) })}
                >
                  <SelectTrigger className="border-neutral-950">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_OPTIONS.map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-end lg:col-span-12">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  aria-label="Smazat řádek"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit a přepočítat doklad"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href={`/portal/invoices/${invoiceId}`}>Zrušit</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
