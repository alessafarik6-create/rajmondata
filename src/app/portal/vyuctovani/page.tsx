"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUser, useFirestore, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Loader2, FileText, Download, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { computeEffectivePlatformInvoiceStatus } from "@/lib/platform-invoice-status";

type PlatformInvoiceRow = {
  id: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  total?: number;
  currency?: string;
  status?: string;
  displayStatus?: string;
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
  const companyId = profile?.companyId as string | undefined;
  const role = (profile?.role as string) || "employee";
  const canRead = role === "owner" || role === "admin" || role === "accountant";

  const [invoices, setInvoices] = useState<PlatformInvoiceRow[]>([]);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !companyId || !canRead) {
      setInvoices([]);
      setUnpaidCount(0);
      setOverdueCount(0);
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
          Vyúčtování od provozovatele platformy je dostupné vlastníkovi, administrátorovi a účetnímu.
        </AlertDescription>
      </Alert>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Chybí firma</AlertTitle>
        <AlertDescription>V profilu není přiřazená organizace.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="portal-page-title text-2xl sm:text-3xl">Vyúčtování</h1>
        <p className="portal-page-description mt-1 text-muted-foreground">
          Faktury vystavené provozovatelem platformy za používání služeb.
        </p>
      </div>

      {overdueCount > 0 ? (
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
        <Alert className="border-2 border-amber-500 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950/35 dark:text-amber-50">
          <FileText className="h-5 w-5 text-amber-700 dark:text-amber-300" />
          <AlertTitle className="text-base font-semibold">Máte vystavenou fakturu k úhradě</AlertTitle>
          <AlertDescription className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Počet dokumentů k úhradě: {unpaidCount}. Zkontrolujte splatnosti v tabulce níže.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Seznam faktur</CardTitle>
          <CardDescription>Číslo faktury, data, částka a stav úhrady.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 pb-6">Zatím nemáte žádné faktury od provozovatele.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Číslo</TableHead>
                    <TableHead>Vystaveno</TableHead>
                    <TableHead>Splatnost</TableHead>
                    <TableHead className="text-right">Částka</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead className="text-right pr-4">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const eff = computeEffectivePlatformInvoiceStatus(
                      String(inv.status || "unpaid"),
                      inv.dueDate
                    );
                    return (
                      <TableRow
                        key={inv.id}
                        className={
                          eff === "overdue"
                            ? "bg-rose-50/90 dark:bg-rose-950/30 border-l-4 border-l-rose-600"
                            : eff === "unpaid"
                              ? "bg-amber-50/80 dark:bg-amber-950/25 border-l-4 border-l-amber-500"
                              : undefined
                        }
                      >
                        <TableCell className="font-mono text-sm font-semibold">
                          {inv.invoiceNumber || inv.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatDateCs(inv.issueDate)}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{formatDateCs(inv.dueDate)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(inv.total, inv.currency || "CZK")}
                        </TableCell>
                        <TableCell>
                          {eff === "overdue" || eff === "unpaid" ? (
                            <Badge
                              variant={eff === "overdue" ? "destructive" : "outline"}
                              className={
                                eff === "unpaid"
                                  ? "border-amber-600 text-amber-900 bg-amber-100/80 font-semibold"
                                  : "font-semibold"
                              }
                            >
                              {statusLabel(eff)}
                            </Badge>
                          ) : (
                            <Badge variant={eff === "paid" ? "default" : "secondary"}>{statusLabel(eff)}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-2">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={pdfBusyId === inv.id}
                              onClick={() => void openPdf(inv, false)}
                            >
                              {pdfBusyId === inv.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ExternalLink className="h-4 w-4 mr-1" />
                              )}
                              PDF
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8"
                              disabled={pdfBusyId === inv.id}
                              onClick={() => void openPdf(inv, true)}
                            >
                              <Download className="h-4 w-4 mr-1" />
                              Stáhnout
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Zpět na <Link href="/portal/dashboard" className="text-primary underline">přehled</Link>.
      </p>
    </div>
  );
}
