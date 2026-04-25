"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
import {
  CreditCard,
  Download,
  Search,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { computeEffectivePlatformInvoiceStatus } from "@/lib/platform-invoice-status";

type PlatformInvoiceRow = {
  id: string;
  invoiceNumber?: string;
  organizationId?: string;
  organizationName?: string;
  issueDate?: string;
  dueDate?: string;
  total?: number;
  currency?: string;
  status?: string;
  pdfUrl?: string;
};

function formatMoneyCzk(n: unknown): string {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return "—";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 2,
  }).format(x);
}

function statusBadge(eff: ReturnType<typeof computeEffectivePlatformInvoiceStatus>) {
  switch (eff) {
    case "paid":
      return <Badge className="bg-emerald-600">Uhrazeno</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Stornováno</Badge>;
    case "overdue":
      return <Badge variant="destructive">Po splatnosti</Badge>;
    default:
      return <Badge variant="outline" className="border-amber-500 text-amber-800">K úhradě</Badge>;
  }
}

export default function AdminBillingPage() {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<PlatformInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [patchingId, setPatchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/superadmin/platform-invoices", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : "Načtení faktur se nezdařilo.",
        });
        setInvoices([]);
        return;
      }
      const list = Array.isArray(data?.invoices) ? (data.invoices as PlatformInvoiceRow[]) : [];
      setInvoices(list);
    } catch {
      toast({ variant: "destructive", title: "Chyba", description: "Načtení faktur se nezdařilo." });
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => {
      const blob = [
        inv.invoiceNumber,
        inv.organizationId,
        inv.organizationName,
        inv.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [invoices, search]);

  const stats = useMemo(() => {
    let expected = 0;
    let paid = 0;
    let overdue = 0;
    for (const inv of invoices) {
      const eff = computeEffectivePlatformInvoiceStatus(String(inv.status || "unpaid"), inv.dueDate);
      const t = Number(inv.total);
      const amt = Number.isFinite(t) ? t : 0;
      if (eff === "paid") paid += amt;
      else if (eff === "cancelled") continue;
      else {
        expected += amt;
        if (eff === "overdue") overdue += amt;
      }
    }
    return { expected, paid, overdue };
  }, [invoices]);

  const patchStatus = async (id: string, status: "paid" | "unpaid" | "cancelled") => {
    setPatchingId(id);
    try {
      const res = await fetch(`/api/superadmin/platform-invoices/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : "Uložení se nezdařilo.",
        });
        return;
      }
      toast({
        title: "Uloženo",
        description:
          status === "paid"
            ? "Faktura označena jako uhrazená."
            : status === "cancelled"
              ? "Faktura stornována."
              : "Faktura označena jako neuhrazená.",
      });
      await load();
    } finally {
      setPatchingId(null);
    }
  };

  const exportCsv = () => {
    const rows = filtered.map((inv) => {
      const eff = computeEffectivePlatformInvoiceStatus(String(inv.status || "unpaid"), inv.dueDate);
      return [
        inv.invoiceNumber || inv.id,
        inv.organizationName || "",
        inv.organizationId || "",
        inv.issueDate || "",
        inv.dueDate || "",
        inv.total ?? "",
        eff,
      ];
    });
    const header = ["cislo", "organizace", "organizationId", "vystaveno", "splatnost", "castka", "stav"];
    const esc = (c: string | number) => {
      const s = String(c);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const body = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platform-faktury-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-3xl font-bold">Fakturace platformy</h1>
          <p className="text-muted-foreground mt-2">
            Faktury vystavené organizacím. Vystavení nové faktury probíhá u organizace v sekci Organizace.
          </p>
        </div>
        <Button variant="outline" className="gap-2 self-start" asChild>
          <a href="/admin/billing-provider">
            <CreditCard className="w-4 h-4" /> Provozovatel / údaje
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">K úhradě (neuhrazené)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{formatMoneyCzk(stats.expected)}</div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Uhrazeno</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{formatMoneyCzk(stats.paid)}</div>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Po splatnosti (částka)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">{formatMoneyCzk(stats.overdue)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="p-4 border-b bg-background/30 flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Hledat firmu, číslo faktury…"
              className="pl-10 bg-background border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Obnovit
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filtered.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-6">Číslo</TableHead>
                  <TableHead>Organizace</TableHead>
                  <TableHead>Vystaveno</TableHead>
                  <TableHead>Splatnost</TableHead>
                  <TableHead className="text-right">Částka</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead className="pr-6 text-right">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => {
                  const eff = computeEffectivePlatformInvoiceStatus(
                    String(inv.status || "unpaid"),
                    inv.dueDate
                  );
                  const busy = patchingId === inv.id;
                  return (
                    <TableRow key={inv.id} className="border-border hover:bg-muted/30">
                      <TableCell className="pl-6 font-mono text-sm font-semibold">
                        {inv.invoiceNumber || inv.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{inv.organizationName || "—"}</span>
                          <span className="text-xs text-muted-foreground font-mono">{inv.organizationId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {inv.issueDate
                          ? new Date(inv.issueDate + "T12:00:00").toLocaleDateString("cs-CZ")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {inv.dueDate
                          ? new Date(inv.dueDate + "T12:00:00").toLocaleDateString("cs-CZ")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatMoneyCzk(inv.total)}</TableCell>
                      <TableCell>{statusBadge(eff)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {inv.pdfUrl ? (
                            <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                              <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" title="PDF">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          ) : null}
                          {eff !== "paid" && eff !== "cancelled" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={busy}
                              onClick={() => void patchStatus(inv.id, "paid")}
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1" />
                              Uhrazeno
                            </Button>
                          ) : null}
                          {eff === "paid" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={busy}
                              onClick={() => void patchStatus(inv.id, "unpaid")}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Neuhrazeno
                            </Button>
                          ) : null}
                          {eff !== "cancelled" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-destructive"
                              disabled={busy}
                              onClick={() => void patchStatus(inv.id, "cancelled")}
                            >
                              <Ban className="w-4 h-4 mr-1" />
                              Storno
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-20 text-muted-foreground space-y-2">
              <p>Zatím nejsou žádné faktury nebo nic neodpovídá vyhledávání.</p>
              <p className="text-sm">
                <a href="/admin/companies" className="text-primary underline">
                  Vystavit fakturu u organizace
                </a>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
