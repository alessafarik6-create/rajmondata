"use client";

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import {
  Loader2,
  FileText,
  Download,
  ExternalLink,
  AlertTriangle,
  CalendarClock,
  AlertCircle,
  FileStack,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { computeEffectivePlatformInvoiceStatus } from "@/lib/platform-invoice-status";

type PlatformInvoiceRow = {
  id: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  periodFrom?: string;
  periodTo?: string;
  total?: number;
  totalAmount?: number;
  currency?: string;
  status?: string;
  displayStatus?: string;
  paymentClaimed?: boolean;
  gracePeriodUntil?: string;
  paymentQr?: { qrUrl?: string; spd?: string; warning?: string | null } | null;
  qrPaymentData?: { qrUrl?: string; spd?: string; warning?: string | null };
  baseLicensePrice?: number;
  modulesTotal?: number;
  employeePrice?: number;
  employeeCount?: number;
  employeeTotal?: number;
  items?: Array<{
    description?: string;
    quantity?: number;
    unitPriceNet?: number;
    lineNet?: number;
  }>;
  pdfUrl?: string;
  storagePath?: string;
  transferredToDocumentId?: string;
};

type BillingSummary = {
  hasUnpaidEffective?: boolean;
  paymentClaimActive?: boolean;
  gracePeriodUntilIso?: string | null;
  graceMsRemaining?: number;
  accountSuspendedForPayment?: boolean;
};

function formatMoney(n: unknown, currency = "CZK"): string {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(x);
}

function formatDateCs(iso: string | undefined): string {
  if (!iso) return "—";
  const d = String(iso).slice(0, 10);
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("cs-CZ");
}

function formatGraceRemaining(iso: string | null | undefined, _tick = 0): string {
  if (!iso) return "—";
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return "—";
  const ms = Math.max(0, end - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h} h ${m} min`;
}

function invoiceBreakdown(inv: PlatformInvoiceRow): ReactNode {
  const base = Number(inv.baseLicensePrice);
  const mod = Number(inv.modulesTotal);
  const ec = Number(inv.employeeCount);
  const ep = Number(inv.employeePrice);
  const et = Number(inv.employeeTotal);
  const hasAgg =
    (Number.isFinite(base) && base > 0) ||
    (Number.isFinite(mod) && mod > 0) ||
    (Number.isFinite(ec) && ec > 0) ||
    (Number.isFinite(et) && et > 0);
  if (hasAgg) {
    return (
      <ul className="text-xs text-muted-foreground space-y-1 max-w-[260px]">
        {Number.isFinite(base) && base > 0 ? (
          <li>Základní licence (bez DPH): {formatMoney(base, inv.currency || "CZK")}</li>
        ) : null}
        {Number.isFinite(mod) && mod > 0 ? (
          <li>Aktivní moduly (bez DPH): {formatMoney(mod, inv.currency || "CZK")}</li>
        ) : null}
        {Number.isFinite(ec) && ec > 0 && Number.isFinite(ep) && ep > 0 ? (
          <li>
            Zaměstnanci: {formatMoney(ep, inv.currency || "CZK")} × {ec} ={" "}
            {formatMoney(Number.isFinite(et) && et > 0 ? et : ec * ep, inv.currency || "CZK")} (bez DPH)
          </li>
        ) : null}
        <li className="font-medium text-foreground">
          Celkem k úhradě: {formatMoney(inv.totalAmount ?? inv.total, inv.currency || "CZK")}
        </li>
      </ul>
    );
  }
  const items = Array.isArray(inv.items) ? inv.items : [];
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <ul className="text-xs text-muted-foreground space-y-1 max-w-[260px]">
      {items.slice(0, 8).map((it, i) => (
        <li key={i}>
          {(it.description || "Položka").slice(0, 42)}
          {it.quantity != null && it.quantity > 1 ? ` × ${it.quantity}` : ""}:{" "}
          {formatMoney(it.lineNet, inv.currency || "CZK")} (bez DPH)
        </li>
      ))}
      {items.length > 8 ? <li>…</li> : null}
    </ul>
  );
}

function qrForInvoice(inv: PlatformInvoiceRow): { qrUrl: string; warning?: string | null } | null {
  if (inv.paymentQr?.qrUrl && !inv.paymentQr.warning) {
    return { qrUrl: inv.paymentQr.qrUrl, warning: inv.paymentQr.warning };
  }
  const q = inv.qrPaymentData;
  if (q?.qrUrl && !q.warning) return { qrUrl: q.qrUrl, warning: q.warning };
  return inv.paymentQr?.warning
    ? { qrUrl: "", warning: inv.paymentQr.warning }
    : q?.warning
      ? { qrUrl: "", warning: q.warning }
      : null;
}

function statusLabel(eff: ReturnType<typeof computeEffectivePlatformInvoiceStatus>): string {
  switch (eff) {
    case "paid":
      return "Uhrazeno";
    case "cancelled":
      return "Stornováno";
    case "overdue":
      return "Po splatnosti";
    default:
      return "K úhradě";
  }
}

export default function VyuctovaniPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const firestore = useFirestore();

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: profileLoading } = useDoc(userRef);
  const companyId = (profile?.companyId ?? profile?.organizationId) as string | undefined;
  const role = (profile?.role as string) || "employee";
  const canRead = role === "owner" || role === "admin" || role === "accountant";

  const [invoices, setInvoices] = useState<PlatformInvoiceRow[]>([]);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [transferBusyId, setTransferBusyId] = useState<string | null>(null);
  const [graceTick, setGraceTick] = useState(0);

  const load = useCallback(async () => {
    if (!user || !companyId || !canRead) {
      setInvoices([]);
      setUnpaidCount(0);
      setOverdueCount(0);
      setBilling(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/platform-invoices", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Nelze načíst faktury",
          description: typeof data?.error === "string" ? data.error : undefined,
        });
        setInvoices([]);
        return;
      }
      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      setUnpaidCount(Number(data.unpaidCount) || 0);
      setOverdueCount(Number(data.overdueCount) || 0);
      const b = data.billing;
      setBilling(
        b && typeof b === "object"
          ? {
              hasUnpaidEffective: Boolean(b.hasUnpaidEffective),
              paymentClaimActive: Boolean(b.paymentClaimActive),
              gracePeriodUntilIso:
                typeof b.gracePeriodUntilIso === "string" ? b.gracePeriodUntilIso : null,
              graceMsRemaining: Number(b.graceMsRemaining) || 0,
              accountSuspendedForPayment: Boolean(b.accountSuspendedForPayment),
            }
          : null
      );
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě při načítání faktur." });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [user, companyId, canRead, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!billing?.paymentClaimActive) return;
    const t = window.setInterval(() => setGraceTick((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [billing?.paymentClaimActive]);

  const latestUnpaidInvoiceId = useMemo(() => {
    for (const inv of invoices) {
      const eff = computeEffectivePlatformInvoiceStatus(String(inv.status || "unpaid"), inv.dueDate);
      if (eff === "unpaid" || eff === "overdue") return inv.id;
    }
    return null;
  }, [invoices]);

  const openPdf = async (inv: PlatformInvoiceRow, download: boolean) => {
    if (!user) return;
    setPdfBusyId(inv.id);
    try {
      const token = await user.getIdToken();
      const q = download ? "?download=1" : "";
      const res = await fetch(`/api/company/platform-invoices/${encodeURIComponent(inv.id)}/pdf${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast({
          variant: "destructive",
          title: "PDF se nepodařilo otevřít",
          description: typeof j?.error === "string" ? j.error : `HTTP ${res.status}`,
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${inv.invoiceNumber || inv.id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      }
    } catch {
      toast({ variant: "destructive", title: "PDF se nepodařilo stáhnout." });
    } finally {
      setPdfBusyId(null);
    }
  };

  const transferToDocuments = async (inv: PlatformInvoiceRow) => {
    if (!user) return;
    setTransferBusyId(inv.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/platform-invoices/${encodeURIComponent(inv.id)}/transfer-to-documents`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Přenos se nezdařil",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      toast({
        title: data?.alreadyTransferred ? "Již v dokladech" : "Přeneseno",
        description: data?.alreadyTransferred
          ? "Tato faktura už byla mezi doklady."
          : "PDF bylo uloženo do sekce Doklady.",
      });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
    } finally {
      setTransferBusyId(null);
    }
  };

  const claimPaid = async (inv: PlatformInvoiceRow) => {
    if (!user) return;
    setClaimBusyId(inv.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/platform-invoices/${encodeURIComponent(inv.id)}/claim-payment`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Akci nelze provést",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      toast({
        title: data?.alreadyClaimed ? "Lhůta již běží" : "Oznámení uloženo",
        description:
          "Platba čeká na potvrzení superadministrátorem. Účet zůstává aktivní ještě 48 hodin.",
      });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
    } finally {
      setClaimBusyId(null);
    }
  };

  if (profileLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!canRead) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Přístup omezen</AlertTitle>
        <AlertDescription>
          Vyúčtování služeb od provozovatele platformy je dostupné vlastníkovi, administrátorovi a účetnímu.
        </AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>V profilu není přiřazená organizace (companyId / organizationId).</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Vyúčtování služeb</h1>
        <p className="portal-page-description mt-1 text-muted-foreground">
          Faktury vystavené provozovatelem platformy za používání služeb.
        </p>
      </div>

      {billing?.accountSuspendedForPayment ? (
        <Alert className="border-2 border-red-700 bg-red-50 text-red-950 shadow-md dark:border-red-500 dark:bg-red-950/45 dark:text-red-50">
          <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-400" />
          <AlertTitle className="text-base font-semibold">Účet byl deaktivován</AlertTitle>
          <AlertDescription className="text-sm font-medium text-red-900 dark:text-red-100">
            Účet byl deaktivován kvůli nepotvrzené úhradě faktury.
          </AlertDescription>
        </Alert>
      ) : billing?.paymentClaimActive ? (
        <Alert className="border-2 border-sky-600 bg-sky-50 text-sky-950 shadow-md dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-50">
          <CalendarClock className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          <AlertTitle className="text-base font-semibold">Platba čeká na potvrzení</AlertTitle>
          <AlertDescription className="text-sm font-medium text-sky-900 dark:text-sky-100">
            Platba čeká na potvrzení superadministrátorem. Účet zůstává aktivní ještě 48 hodin. Zbývá:{" "}
            {formatGraceRemaining(billing.gracePeriodUntilIso, graceTick)}.
          </AlertDescription>
        </Alert>
      ) : overdueCount > 0 ? (
        <Alert className="border-2 border-rose-600 bg-rose-50 text-rose-950 shadow-md dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-50">
          <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          <AlertTitle className="text-base font-semibold">Faktury po splatnosti</AlertTitle>
          <AlertDescription className="text-sm font-medium text-rose-900 dark:text-rose-100">
            Máte {overdueCount}{" "}
            {overdueCount === 1 ? "fakturu po splatnosti" : overdueCount < 5 ? "faktury po splatnosti" : "faktur po splatnosti"}.
            Uhraďte je prosím co nejdříve.
          </AlertDescription>
        </Alert>
      ) : unpaidCount > 0 ? (
        <Alert className="border-2 border-rose-600 bg-rose-50 text-rose-950 shadow-md dark:border-rose-500 dark:bg-rose-950/40 dark:text-rose-50">
          <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          <AlertTitle className="text-base font-semibold">Máte neuhrazenou fakturu za služby platformy</AlertTitle>
          <AlertDescription className="text-sm font-medium text-rose-900 dark:text-rose-100">
            Počet neuhrazených faktur: {unpaidCount}. Níže je QR platba (pokud je k dispozici platební účet).
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Seznam faktur</CardTitle>
          <CardDescription>
            Každá faktura je v samostatné kartě — číslo, stav, datumy, částka, výpočet, QR a akce.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím nemáte žádné faktury od provozovatele.</p>
          ) : (
            invoices.map((inv) => {
              const eff = computeEffectivePlatformInvoiceStatus(
                String(inv.status || "unpaid"),
                inv.dueDate
              );
              const graceEnd = inv.gracePeriodUntil ? Date.parse(String(inv.gracePeriodUntil)) : NaN;
              const claimGraceActive =
                inv.paymentClaimed === true && Number.isFinite(graceEnd) && graceEnd > Date.now();
              const showClaimBtn =
                (eff === "unpaid" || eff === "overdue") &&
                inv.id === latestUnpaidInvoiceId &&
                !claimGraceActive;
              const unpaidHighlight = eff === "overdue" || eff === "unpaid";
              const transferredId = String(inv.transferredToDocumentId || "").trim();
              const hasPdf =
                (typeof inv.pdfUrl === "string" && inv.pdfUrl.trim()) ||
                (typeof inv.storagePath === "string" && inv.storagePath.trim());
              const qr = qrForInvoice(inv);

              return (
                <Card
                  key={inv.id}
                  className={cn(
                    "overflow-hidden border-border/80 shadow-sm",
                    unpaidHighlight &&
                      "border-rose-600/80 bg-rose-50/90 dark:border-rose-500 dark:bg-rose-950/35"
                  )}
                >
                  <CardContent className="space-y-4 p-4 sm:p-6">
                    <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-3">
                      <div className="min-w-0 space-y-1 lg:col-span-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Číslo faktury
                        </p>
                        <p className="font-mono text-base font-semibold break-all">
                          {inv.invoiceNumber || inv.id.slice(0, 8)}
                        </p>
                        {inv.periodFrom && inv.periodTo ? (
                          <p className="text-xs text-muted-foreground">
                            Období: {formatDateCs(inv.periodFrom)} – {formatDateCs(inv.periodTo)}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0 space-y-1 lg:col-span-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stav</p>
                        <div className="flex flex-col gap-1">
                          {unpaidHighlight ? (
                            <Badge variant="destructive" className="w-fit font-semibold">
                              {statusLabel(eff)}
                            </Badge>
                          ) : (
                            <Badge variant={eff === "paid" ? "default" : "secondary"} className="w-fit">
                              {statusLabel(eff)}
                            </Badge>
                          )}
                          {claimGraceActive ? (
                            <span className="text-xs text-sky-800 dark:text-sky-200">
                              Čeká na potvrzení provozovatele. Zbývá:{" "}
                              {formatGraceRemaining(String(inv.gracePeriodUntil), graceTick)}.
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="min-w-0 space-y-1 lg:col-span-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Datum</p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Vystaveno:</span>{" "}
                          {formatDateCs(inv.issueDate)}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">Splatnost:</span> {formatDateCs(inv.dueDate)}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-1 lg:col-span-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Částka</p>
                        <p
                          className={cn(
                            "text-lg font-semibold tabular-nums tracking-tight",
                            unpaidHighlight && "text-rose-900 dark:text-rose-100"
                          )}
                        >
                          {formatMoney(inv.total, inv.currency || "CZK")}
                        </p>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Výpočet zaměstnanců a položek
                      </p>
                      <div className="text-sm">{invoiceBreakdown(inv)}</div>
                    </div>

                    <Separator />

                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 shrink-0 space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          QR platba
                        </p>
                        {eff === "paid" || eff === "cancelled" ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : qr?.qrUrl ? (
                          <img
                            src={qr.qrUrl}
                            alt="QR platba SPD"
                            width={114}
                            height={114}
                            className="rounded-md border border-border bg-white p-1 shadow-sm"
                          />
                        ) : (
                          <p className="max-w-xs text-sm text-muted-foreground">{qr?.warning || "QR nelze zobrazit"}</p>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Akce</p>
                        <div className="flex flex-wrap gap-2">
                          {showClaimBtn ? (
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className="bg-rose-700 hover:bg-rose-800"
                              disabled={claimBusyId === inv.id}
                              onClick={() => void claimPaid(inv)}
                            >
                              {claimBusyId === inv.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Zaplatil jsem"
                              )}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pdfBusyId === inv.id}
                            onClick={() => void openPdf(inv, false)}
                          >
                            {pdfBusyId === inv.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <ExternalLink className="mr-1 h-4 w-4" />
                                PDF
                              </>
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={pdfBusyId === inv.id}
                            onClick={() => void openPdf(inv, true)}
                          >
                            <Download className="mr-1 h-4 w-4" />
                            Stáhnout
                          </Button>
                          {hasPdf ? (
                            transferredId ? (
                              <Button type="button" variant="outline" size="sm" disabled className="border-emerald-600/50">
                                Již v dokladech
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={transferBusyId === inv.id}
                                onClick={() => void transferToDocuments(inv)}
                              >
                                {transferBusyId === inv.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <FileStack className="mr-1 h-4 w-4" />
                                    Přenést do dokladů
                                  </>
                                )}
                              </Button>
                            )
                          ) : null}
                          {transferredId ? (
                            <Button type="button" variant="ghost" size="sm" asChild className="px-2">
                              <Link href="/portal/documents">Doklady</Link>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Zpět na <Link href="/portal/dashboard" className="text-primary underline">přehled</Link>.
      </p>
    </div>
  );
}
