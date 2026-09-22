"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCompany,
  useCollection,
} from "@/firebase";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { buildCustomerAddressMultiline } from "@/lib/customer-address-display";
import {
  invoiceItemsToManualLines,
  JOB_INVOICE_TYPES,
  updateAdvanceInvoiceItems,
  updateFinalSettlementInvoice,
  updateTaxReceiptDocument,
  type ManualAdvanceLineInput,
  type OrgBankAccountRow,
} from "@/lib/job-billing-invoices";
import { normalizeVatRate } from "@/lib/vat-calculations";
import { useToast } from "@/hooks/use-toast";
import { PORTAL_MANUAL_INVOICE_TYPE } from "@/lib/portal-manual-invoice";
import { PortalManualInvoiceForm } from "@/components/invoices/portal-manual-invoice-form";
import { canManagePortalInvoices } from "@/lib/portal-invoice-permissions";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  InvoiceCustomerSnapshot,
  InvoiceRecipientType,
} from "@/lib/invoice-customer-snapshot";
import {
  invoiceRecipientAddressLines,
  invoiceRecipientDisplayName,
  snapshotFromCustomerDoc,
  snapshotFromInvoiceRecord,
} from "@/lib/invoice-customer-snapshot";

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

  const bankAccountsColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "bankAccounts")
        : null,
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

  const [lines, setLines] = useState<ManualAdvanceLineInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [totalContractGross, setTotalContractGross] = useState(0);
  const [totalAdvancePaid, setTotalAdvancePaid] = useState(0);
  const [notes, setNotes] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxSupplyDate, setTaxSupplyDate] = useState("");
  const [variableSymbol, setVariableSymbol] = useState("");
  const [bankAccountId, setBankAccountId] = useState<string | "">("");
  const [paymentDate, setPaymentDate] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [supplierIco, setSupplierIco] = useState("");
  const [supplierDic, setSupplierDic] = useState("");
  const [customerIco, setCustomerIco] = useState("");
  const [customerDic, setCustomerDic] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const customerPhone = useMemo(() => {
    const c = customerDoc as { phone?: string } | null | undefined;
    const v = String(c?.phone ?? "").trim();
    return v || null;
  }, [customerDoc]);
  const customerEmail = useMemo(() => {
    const c = customerDoc as { email?: string } | null | undefined;
    const v = String(c?.email ?? "").trim();
    return v || null;
  }, [customerDoc]);

  const jobName = useMemo(() => {
    const j = jobDoc as Record<string, unknown> | null | undefined;
    return String(j?.name ?? j?.title ?? "Zakázka").trim() || "Zakázka";
  }, [jobDoc]);

  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerAddress, setEditCustomerAddress] = useState("");
  const [taxRecipientType, setTaxRecipientType] = useState<InvoiceRecipientType>("person");
  const [taxSelectedCustomerId, setTaxSelectedCustomerId] = useState("");
  const [taxCompanyName, setTaxCompanyName] = useState("");
  const [taxFirstName, setTaxFirstName] = useState("");
  const [taxLastName, setTaxLastName] = useState("");
  const [taxStreet, setTaxStreet] = useState("");
  const [taxCity, setTaxCity] = useState("");
  const [taxPostalCode, setTaxPostalCode] = useState("");
  const [taxCountry, setTaxCountry] = useState("CZ");
  const [taxEditPhone, setTaxEditPhone] = useState("");
  const [taxEditEmail, setTaxEditEmail] = useState("");
  const [taxCustomerSearch, setTaxCustomerSearch] = useState("");
  const [taxUpdateMasterCustomer, setTaxUpdateMasterCustomer] = useState(false);

  const customersColRef = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "customers")
        : null,
    [firestore, companyId]
  );
  const { data: customersRaw } = useCollection(customersColRef);
  const customers = useMemo(
    () => (Array.isArray(customersRaw) ? customersRaw : []) as { id: string }[],
    [customersRaw]
  );

  const filteredTaxCustomers = useMemo(() => {
    const q = taxCustomerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 40);
    return customers
      .filter((c) => {
        const row = c as Record<string, unknown>;
        const hay = [
          row.companyName,
          row.firstName,
          row.lastName,
          row.ico,
          row.ic,
          row.email,
          row.phone,
        ]
          .map((x) => String(x ?? "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [customers, taxCustomerSearch]);

  const applyTaxCustomerFromDoc = (row: Record<string, unknown> & { id: string }) => {
    const snap = snapshotFromCustomerDoc(row.id, row);
    setTaxSelectedCustomerId(row.id);
    setTaxRecipientType(snap.type);
    setTaxCompanyName(String(snap.companyName ?? ""));
    setTaxFirstName(String(snap.firstName ?? ""));
    setTaxLastName(String(snap.lastName ?? ""));
    setTaxStreet(String(snap.street ?? ""));
    setTaxCity(String(snap.city ?? ""));
    setTaxPostalCode(String(snap.postalCode ?? ""));
    setTaxCountry(String(snap.country ?? "CZ"));
    setTaxEditPhone(String(snap.phone ?? ""));
    setTaxEditEmail(String(snap.email ?? ""));
    setCustomerIco(String(snap.ico ?? ""));
    setCustomerDic(String(snap.dic ?? ""));
    setEditCustomerName(invoiceRecipientDisplayName(snap));
    setEditCustomerAddress(invoiceRecipientAddressLines(snap));
  };

  const buildTaxCustomerSnapshot = (): InvoiceCustomerSnapshot => ({
    customerId: taxSelectedCustomerId.trim() || null,
    type: taxRecipientType,
    companyName:
      taxRecipientType === "company" ? taxCompanyName.trim() || null : null,
    firstName:
      taxRecipientType === "person" ? taxFirstName.trim() || null : null,
    lastName:
      taxRecipientType === "person" ? taxLastName.trim() || null : null,
    street: taxStreet.trim() || null,
    city: taxCity.trim() || null,
    postalCode: taxPostalCode.trim() || null,
    country: taxCountry.trim() || "CZ",
    ico: customerIco.trim() || null,
    dic: customerDic.trim() || null,
    email: taxEditEmail.trim() || null,
    phone: taxEditPhone.trim() || null,
  });

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
    const t = String(inv.type ?? "");

    const today = new Date().toISOString().slice(0, 10);
    setIssueDate(
      typeof inv.issueDate === "string" && inv.issueDate
        ? inv.issueDate.slice(0, 10)
        : today
    );
    setDueDate(
      typeof inv.dueDate === "string" && inv.dueDate
        ? inv.dueDate.slice(0, 10)
        : typeof inv.issueDate === "string" && inv.issueDate
          ? inv.issueDate.slice(0, 10)
          : today
    );
    setTaxSupplyDate(
      typeof inv.taxSupplyDate === "string" && inv.taxSupplyDate
        ? inv.taxSupplyDate.slice(0, 10)
        : typeof inv.issueDate === "string" && inv.issueDate
          ? inv.issueDate.slice(0, 10)
          : today
    );
    setVariableSymbol(String(inv.variableSymbol ?? ""));
    setBankAccountId(String(inv.bankAccountId ?? ""));
    setPaymentDate(
      typeof inv.paymentDate === "string" && inv.paymentDate
        ? inv.paymentDate.slice(0, 10)
        : ""
    );
    setTaxNote(String(inv.note ?? ""));
    setContractNumber(String(inv.contractNumber ?? ""));
    setEditCustomerName(String(inv.customerName ?? "").trim());

    const co = company as { ico?: string; dic?: string } | null | undefined;
    setSupplierIco(String(inv.supplierIco ?? co?.ico ?? ""));
    setSupplierDic(String(inv.supplierDic ?? co?.dic ?? ""));
    setCustomerIco(String(inv.customerIco ?? ""));
    setCustomerDic(String(inv.customerDic ?? ""));

    if (t === JOB_INVOICE_TYPES.TAX_RECEIPT) {
      const snap = snapshotFromInvoiceRecord(inv);
      setTaxRecipientType(snap.type);
      setTaxSelectedCustomerId(
        String(snap.customerId ?? inv.customerId ?? customerId ?? "").trim()
      );
      setTaxCompanyName(String(snap.companyName ?? ""));
      setTaxFirstName(String(snap.firstName ?? ""));
      setTaxLastName(String(snap.lastName ?? ""));
      setTaxStreet(String(snap.street ?? ""));
      setTaxCity(String(snap.city ?? ""));
      setTaxPostalCode(String(snap.postalCode ?? ""));
      setTaxCountry(String(snap.country ?? "CZ"));
      setTaxEditPhone(
        String(snap.phone ?? inv.customerPhone ?? "").trim()
      );
      setTaxEditEmail(
        String(snap.email ?? inv.customerEmail ?? "").trim()
      );
      setEditCustomerName(
        invoiceRecipientDisplayName(snap) || String(inv.customerName ?? "").trim()
      );
      setEditCustomerAddress(
        invoiceRecipientAddressLines(snap) ||
          String(inv.customerAddressLines ?? inv.customerAddress ?? "").trim()
      );
      setInitialized(true);
      return;
    }

    const fromCust = buildCustomerAddressMultiline(customerDoc);
    setEditCustomerAddress(
      fromCust.trim() || String(inv.customerName ?? "").trim()
    );
    if (t === JOB_INVOICE_TYPES.ADVANCE) {
      setLines(invoiceItemsToManualLines(inv));
      setInitialized(true);
      return;
    }
    if (t === JOB_INVOICE_TYPES.FINAL_INVOICE) {
      setLines(invoiceItemsToManualLines(inv));
      setTotalContractGross(Number(inv.totalContractAmount) || 0);
      setTotalAdvancePaid(Number(inv.totalAdvancePaid) || 0);
      setNotes(String(inv.notes ?? ""));
      setInitialized(true);
    }
  }, [invoice, initialized, customerDoc, company]);

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
    const invType = invoice
      ? String((invoice as { type?: string }).type ?? "")
      : "";
    if (!user || !companyId || !invoiceId) return;
    const taxSnap =
      invType === JOB_INVOICE_TYPES.TAX_RECEIPT ? buildTaxCustomerSnapshot() : null;
    const custName =
      taxSnap != null
        ? invoiceRecipientDisplayName(taxSnap) || "Odběratel"
        : editCustomerName.trim() || "Odběratel";
    const custAddr =
      taxSnap != null
        ? invoiceRecipientAddressLines(taxSnap) || custName
        : editCustomerAddress.trim() || custName;
    setSaving(true);
    try {
      if (invType === JOB_INVOICE_TYPES.TAX_RECEIPT) {
        await updateTaxReceiptDocument({
          firestore,
          companyId,
          invoiceId,
          jobName,
          customerName: custName,
          customerAddressLines: custAddr,
          customerSnapshot: taxSnap,
          customerPhone: taxEditPhone.trim() || null,
          customerEmail: taxEditEmail.trim() || null,
          supplierName,
          supplierAddressLines: supplierAddressLines || supplierName,
          userId: user.uid,
          logoUrl,
          issueDate: issueDate.trim() || undefined,
          taxSupplyDate: taxSupplyDate.trim() || undefined,
          paymentDate: paymentDate.trim() || undefined,
          variableSymbol: variableSymbol.trim() || undefined,
          supplierIco: supplierIco.trim() || null,
          supplierDic: supplierDic.trim() || null,
          customerIco: customerIco.trim() || null,
          customerDic: customerDic.trim() || null,
          orgBankAccounts,
          bankAccountId: bankAccountId || null,
          legacyCompanyBankAccount: legacyCompanyBank,
          note: taxNote.trim() || undefined,
        });
        if (
          taxUpdateMasterCustomer &&
          taxSelectedCustomerId.trim() &&
          firestore
        ) {
          const custRef = doc(
            firestore,
            "companies",
            companyId,
            "customers",
            taxSelectedCustomerId.trim()
          );
          await updateDoc(custRef, {
            updatedAt: serverTimestamp(),
            companyName:
              taxRecipientType === "company" ? taxCompanyName.trim() : "",
            firstName:
              taxRecipientType === "person" ? taxFirstName.trim() : "",
            lastName:
              taxRecipientType === "person" ? taxLastName.trim() : "",
            street: taxStreet.trim(),
            city: taxCity.trim(),
            postalCode: taxPostalCode.trim(),
            country: taxCountry.trim() || "CZ",
            ico: customerIco.trim(),
            dic: customerDic.trim(),
            email: taxEditEmail.trim(),
            phone: taxEditPhone.trim(),
          });
        }
      } else if (invType === JOB_INVOICE_TYPES.FINAL_INVOICE) {
        await updateFinalSettlementInvoice({
          firestore,
          companyId,
          invoiceId,
          jobName,
          customerName: custName,
          customerAddressLines: custAddr,
          customerPhone,
          customerEmail,
          supplierName,
          supplierAddressLines: supplierAddressLines || supplierName,
          userId: user.uid,
          logoUrl,
          lines,
          totalContractGross,
          totalAdvancePaid,
          notes: notes.trim() || undefined,
          issueDate: issueDate.trim() || undefined,
          dueDate: dueDate.trim() || undefined,
          taxSupplyDate: taxSupplyDate.trim() || undefined,
          variableSymbol: variableSymbol.trim() || undefined,
          contractNumber: contractNumber.trim() || null,
          supplierIco: supplierIco.trim() || null,
          supplierDic: supplierDic.trim() || null,
          customerIco: customerIco.trim() || null,
          customerDic: customerDic.trim() || null,
          orgBankAccounts,
          bankAccountId: bankAccountId || null,
          legacyCompanyBankAccount: legacyCompanyBank,
        });
      } else {
        await updateAdvanceInvoiceItems({
          firestore,
          companyId,
          invoiceId,
          jobName,
          customerName: custName,
          customerAddressLines: custAddr,
          customerPhone,
          customerEmail,
          supplierName,
          supplierAddressLines: supplierAddressLines || supplierName,
          userId: user.uid,
          logoUrl,
          lines,
          issueDate: issueDate.trim() || undefined,
          dueDate: dueDate.trim() || undefined,
          taxSupplyDate: taxSupplyDate.trim() || undefined,
          variableSymbol: variableSymbol.trim() || undefined,
          supplierIco: supplierIco.trim() || null,
          supplierDic: supplierDic.trim() || null,
          customerIco: customerIco.trim() || null,
          customerDic: customerDic.trim() || null,
          orgBankAccounts,
          bankAccountId: bankAccountId || null,
          legacyCompanyBankAccount: legacyCompanyBank,
        });
      }
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
          <Link href="/portal/documents?view=issued" className="underline">
            Zpět na doklady
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if ((invoice as { isDeleted?: boolean }).isDeleted === true) {
    return (
      <Alert className="max-w-xl border-amber-300 bg-amber-50">
        <AlertTitle>Doklad je v koši</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>Smazaný doklad nelze upravovat.</p>
          <Link href="/portal/documents?view=trash" className="font-medium underline">
            Zobrazit koš
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const invType = String((invoice as { type?: string }).type ?? "");
  const userRole = String((profile as { role?: string } | null | undefined)?.role ?? "employee");
  if (!canManagePortalInvoices(userRole)) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Bez oprávnění</AlertTitle>
        <AlertDescription>
          Úpravu faktury mohou provádět pouze role s oprávněním k fakturaci.{" "}
          <Link href={`/portal/invoices/${invoiceId}`} className="underline">
            Zpět na náhled
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  if (invType === PORTAL_MANUAL_INVOICE_TYPE && user && firestore && companyId && invoiceId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-2 pb-10 sm:px-0">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/portal/invoices/${invoiceId}`} aria-label="Zpět">
              <ChevronLeft className="h-6 w-6" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">Upravit fakturu</h1>
        </div>
        <PortalManualInvoiceForm
          firestore={firestore}
          companyId={companyId}
          userId={user.uid}
          mode="edit"
          invoiceId={invoiceId}
          initialInvoice={invoice as Record<string, unknown>}
        />
      </div>
    );
  }

  const isFinal = invType === JOB_INVOICE_TYPES.FINAL_INVOICE;
  const isTax = invType === JOB_INVOICE_TYPES.TAX_RECEIPT;
  if (
    invType !== JOB_INVOICE_TYPES.ADVANCE &&
    invType !== JOB_INVOICE_TYPES.FINAL_INVOICE &&
    invType !== JOB_INVOICE_TYPES.TAX_RECEIPT
  ) {
    return (
      <Alert className="max-w-xl">
        <AlertTitle>Úprava není k dispozici</AlertTitle>
        <AlertDescription>
          Úplná úprava je u zálohové faktury, vyúčtovací faktury, daňového dokladu a ruční faktury z portálu.{" "}
          <Link href={`/portal/invoices/${invoiceId}`} className="underline">
            Zpět na doklad
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const titleEdit = isTax
    ? "Upravit daňový doklad"
    : isFinal
      ? "Upravit vyúčtovací fakturu"
      : "Upravit zálohovou fakturu";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-2 pb-10 sm:px-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/portal/invoices/${invoiceId}`} aria-label="Zpět">
            <ChevronLeft className="h-6 w-6" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-neutral-950 sm:text-2xl">{titleEdit}</h1>
      </div>

      <p className="text-sm text-neutral-700">
        Zakázka: <strong>{jobName}</strong>
      </p>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {isTax ? (
            <>
              <div className="sm:col-span-2 space-y-2 rounded-md border border-neutral-100 bg-neutral-50/80 p-3">
                <Label>Vybrat zákazníka</Label>
                <Input
                  value={taxCustomerSearch}
                  onChange={(e) => setTaxCustomerSearch(e.target.value)}
                  placeholder="Hledat jméno, firmu, IČO, e-mail, telefon…"
                  className="border-neutral-950 bg-white"
                />
                {filteredTaxCustomers.length > 0 ? (
                  <ul className="max-h-40 overflow-y-auto rounded border border-neutral-200 bg-white text-sm">
                    {filteredTaxCustomers.map((c) => {
                      const row = c as Record<string, unknown>;
                      const label =
                        String(row.companyName ?? "").trim() ||
                        `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() ||
                        c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-neutral-100"
                            onClick={() =>
                              applyTaxCustomerFromDoc(
                                row as Record<string, unknown> & { id: string }
                              )
                            }
                          >
                            {label}
                            {row.ico ? (
                              <span className="text-neutral-500"> · IČ {String(row.ico)}</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <p className="text-xs text-neutral-600">
                  Údaje se uloží jako snapshot na dokladu; kartu zákazníka měníte volitelně níže.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Label>Typ odběratele</Label>
                <Select
                  value={taxRecipientType}
                  onValueChange={(v) => setTaxRecipientType(v as InvoiceRecipientType)}
                >
                  <SelectTrigger className="border-neutral-950">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="person">Fyzická osoba</SelectItem>
                    <SelectItem value="company">Firma / podnikatel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {taxRecipientType === "company" ? (
                <div className="sm:col-span-2">
                  <Label>Název firmy</Label>
                  <Input
                    value={taxCompanyName}
                    onChange={(e) => setTaxCompanyName(e.target.value)}
                    className="border-neutral-950"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <Label>Jméno</Label>
                    <Input
                      value={taxFirstName}
                      onChange={(e) => setTaxFirstName(e.target.value)}
                      className="border-neutral-950"
                    />
                  </div>
                  <div>
                    <Label>Příjmení</Label>
                    <Input
                      value={taxLastName}
                      onChange={(e) => setTaxLastName(e.target.value)}
                      className="border-neutral-950"
                    />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <Label>Ulice a číslo</Label>
                <Input
                  value={taxStreet}
                  onChange={(e) => setTaxStreet(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Město</Label>
                <Input
                  value={taxCity}
                  onChange={(e) => setTaxCity(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>PSČ</Label>
                <Input
                  value={taxPostalCode}
                  onChange={(e) => setTaxPostalCode(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Stát</Label>
                <Input
                  value={taxCountry}
                  onChange={(e) => setTaxCountry(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  type="email"
                  value={taxEditEmail}
                  onChange={(e) => setTaxEditEmail(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input
                  value={taxEditPhone}
                  onChange={(e) => setTaxEditPhone(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>IČO odběratele</Label>
                <Input
                  value={customerIco}
                  onChange={(e) => setCustomerIco(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>DIČ odběratele</Label>
                <Input
                  value={customerDic}
                  onChange={(e) => setCustomerDic(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div className="sm:col-span-2 flex items-start gap-2 pt-1">
                <Checkbox
                  id="tax-update-master"
                  checked={taxUpdateMasterCustomer}
                  onCheckedChange={(v) => setTaxUpdateMasterCustomer(v === true)}
                />
                <Label htmlFor="tax-update-master" className="font-normal leading-snug">
                  Aktualizovat také kartu zákazníka (výchozí: pouze snapshot na dokladu)
                </Label>
              </div>
            </>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Label>Odběratel (název)</Label>
                <Input
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Adresa odběratele</Label>
                <Textarea
                  value={editCustomerAddress}
                  onChange={(e) => setEditCustomerAddress(e.target.value)}
                  rows={3}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>IČO odběratele</Label>
                <Input
                  value={customerIco}
                  onChange={(e) => setCustomerIco(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>DIČ odběratele</Label>
                <Input
                  value={customerDic}
                  onChange={(e) => setCustomerDic(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
            </>
          )}
          <div>
            <Label>IČO dodavatele</Label>
            <Input
              value={supplierIco}
              onChange={(e) => setSupplierIco(e.target.value)}
              className="border-neutral-950"
            />
          </div>
          <div>
            <Label>DIČ dodavatele</Label>
            <Input
              value={supplierDic}
              onChange={(e) => setSupplierDic(e.target.value)}
              className="border-neutral-950"
            />
          </div>
          {!isTax ? (
            <>
              <div>
                <Label>Datum vystavení</Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Datum zdanitelného plnění</Label>
                <Input
                  type="date"
                  value={taxSupplyDate}
                  onChange={(e) => setTaxSupplyDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Splatnost</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>Datum vystavení dokladu</Label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Datum zdanitelného plnění</Label>
                <Input
                  type="date"
                  value={taxSupplyDate}
                  onChange={(e) => setTaxSupplyDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
              <div>
                <Label>Datum přijetí platby</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="border-neutral-950"
                />
              </div>
            </>
          )}
          <div>
            <Label>Variabilní symbol</Label>
            <Input
              value={variableSymbol}
              onChange={(e) => setVariableSymbol(e.target.value)}
              className="border-neutral-950"
            />
          </div>
          {isFinal ? (
            <div className="sm:col-span-2">
              <Label>Číslo smlouvy (zobrazení)</Label>
              <Input
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                className="border-neutral-950"
              />
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Label>Bankovní účet pro doklad</Label>
            <Select
              value={bankAccountId || "__default__"}
              onValueChange={(v) => setBankAccountId(v === "__default__" ? "" : v)}
            >
              <SelectTrigger className="border-neutral-950">
                <SelectValue placeholder="Výchozí / dle firmy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Výchozí účet organizace</SelectItem>
                {orgBankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {(a.name || "Účet").trim()}{" "}
                    {a.iban
                      ? `· ${a.iban}`
                      : a.accountNumber && a.bankCode
                        ? `· ${a.accountNumber}/${a.bankCode}`
                        : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isTax ? (
          <div>
            <Label>Poznámka</Label>
            <Textarea
              value={taxNote}
              onChange={(e) => setTaxNote(e.target.value)}
              rows={2}
              className="border-neutral-950"
            />
          </div>
        ) : null}
        {isFinal ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Celková cena zakázky (s DPH)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={totalContractGross}
                onChange={(e) => setTotalContractGross(Number(e.target.value.replace(",", ".")) || 0)}
                className="border-neutral-950"
              />
            </div>
            <div>
              <Label>Odečtené zálohy celkem (s DPH)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={totalAdvancePaid}
                onChange={(e) => setTotalAdvancePaid(Number(e.target.value.replace(",", ".")) || 0)}
                className="border-neutral-950"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Poznámka</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="border-neutral-950"
              />
            </div>
          </div>
        ) : null}
        {!isTax ? (
          <>
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
          </>
        ) : (
          <p className="text-sm text-neutral-600">
            Částky na daňovém dokladu jsou vázané na přijatou platbu — upravují se texty a data, ne částka
            dokladu.
          </p>
        )}

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
