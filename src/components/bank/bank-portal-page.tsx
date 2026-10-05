"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser, useCompany } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Landmark } from "lucide-react";
import { downloadCsvFromRows } from "@/lib/csv-download";
import { logPortalExportAudit } from "@/lib/portal-export-audit-client";
import { useToast } from "@/hooks/use-toast";

type OverviewData = {
  connection: {
    configured: boolean;
    status: string;
    lastSyncAt: string | null;
    clientIdMasked: string | null;
  };
  accounts: {
    id: string;
    name: string | null;
    accountNumber: string | null;
    currency: string;
    balance: number | null;
    availableBalance: number | null;
  }[];
  summary: {
    incomingMonth: number;
    outgoingMonth: number;
    unmatchedCount: number;
    matchedCount: number;
  };
};

type TxRow = {
  id: string;
  bookingDate: string;
  direction: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  variableSymbol: string | null;
  message: string | null;
  amount: number;
  currency: string;
  classification: string;
  matchedAmountTotal: number;
};

function formatMoney(n: number, cur: string) {
  return `${n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

export function BankPortalPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("bank");
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterQ, setFilterQ] = useState("");
  const [filterVs, setFilterVs] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [settingsClientId, setSettingsClientId] = useState("");
  const [settingsPassword, setSettingsPassword] = useState("");
  const [settingsFile, setSettingsFile] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { targetKind: string; targetId: string; label: string; confidence: number }[]
  >([]);
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await user!.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [user]);

  const loadOverview = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    const headers = await authHeaders();
    const res = await fetch(
      `/api/company/bank/overview?companyId=${encodeURIComponent(companyId)}`,
      { headers }
    );
    const json = await res.json();
    if (json.ok) setOverview(json);
  }, [user, companyId, access.canRead, authHeaders]);

  const loadTransactions = useCallback(async () => {
    if (!user || !companyId || !access.canRead) return;
    const headers = await authHeaders();
    const params = new URLSearchParams({ companyId, limit: "200" });
    if (filterQ) params.set("q", filterQ);
    if (filterVs) params.set("variableSymbol", filterVs);
    if (datePreset) params.set("datePreset", datePreset);
    const res = await fetch(`/api/company/bank/transactions?${params}`, { headers });
    const json = await res.json();
    if (json.ok) setTransactions(json.transactions ?? []);
  }, [user, companyId, access.canRead, authHeaders, filterQ, filterVs, datePreset]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadTransactions()]);
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadTransactions]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const syncNow = async () => {
    if (!access.canWrite || !user || !companyId || syncing) return;
    setSyncing(true);
    try {
      const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
      const res = await fetch("/api/company/bank/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ companyId }),
      });
      const json = await res.json();
      if (!json.ok && !json.success) {
        const msg =
          (typeof json.message === "string" && json.message.trim()) ||
          (typeof json.display === "string" && json.display.trim()) ||
          (typeof json.error === "string" && json.error.trim()) ||
          "Synchronizace selhala.";
        throw new Error(msg);
      }
      const imported = json.transactionsImported ?? json.imported ?? 0;
      const accounts = json.accountsImported ?? json.accounts ?? 0;
      toast({
        title: "Synchronizace dokončena",
        description: `Účty: ${accounts}, nové transakce: ${imported}`,
      });
      await reload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Synchronizace",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setSyncing(false);
    }
  };

  const exportCsv = async () => {
    if (!access.canRead || !transactions.length) return;
    const rows: string[][] = [
      ["Datum", "Typ", "Protistrana", "VS", "Popis", "Částka", "Měna", "Stav"],
      ...transactions.map((t) => [
        t.bookingDate,
        t.direction === "incoming" ? "Příchozí" : "Odchozí",
        t.counterpartyName ?? "",
        t.variableSymbol ?? "",
        t.message ?? "",
        String(t.amount),
        t.currency,
        t.classification,
      ]),
    ];
    downloadCsvFromRows(rows, "bankovni-transakce.csv");
    if (user) {
      await logPortalExportAudit(user, {
        actionType: "BANK_EXPORT_CREATED",
        moduleId: "bank",
        format: "csv",
        metadata: { rowCount: transactions.length },
      });
    }
  };

  const loadSuggestions = async (transactionId: string) => {
    setSelectedTxn(transactionId);
    const headers = await authHeaders();
    const res = await fetch(
      `/api/company/bank/suggestions?companyId=${encodeURIComponent(companyId!)}&transactionId=${encodeURIComponent(transactionId)}`,
      { headers }
    );
    const json = await res.json();
    if (json.ok) setSuggestions(json.suggestions ?? []);
  };

  const confirmMatch = async (s: {
    targetKind: string;
    targetId: string;
    confidence: number;
  }) => {
    if (!access.canWrite || !selectedTxn || !companyId) return;
    const txn = transactions.find((t) => t.id === selectedTxn);
    if (!txn) return;
    const amount = Math.abs(txn.amount) - (txn.matchedAmountTotal ?? 0);
    const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
    const res = await fetch("/api/company/bank/match", {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId,
        transactionId: selectedTxn,
        matchedAmount: amount,
        matchType: s.confidence >= 85 ? "confirmed_auto" : "manual",
        confidence: s.confidence,
        issuedInvoiceId: s.targetKind === "issued_invoice" ? s.targetId : undefined,
        receivedDocumentId: s.targetKind === "received_document" ? s.targetId : undefined,
      }),
    });
    const json = await res.json();
    if (!json.ok) {
      toast({ variant: "destructive", title: "Párování", description: json.error });
      return;
    }
    toast({ title: "Spárováno", description: "Platba byla propojena s dokladem." });
    await reload();
  };

  const saveSettings = async () => {
    if (!access.canWrite || !companyId || !user) return;
    setSavingSettings(true);
    try {
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("clientId", settingsClientId);
      if (settingsPassword) fd.set("certificatePassword", settingsPassword);
      if (settingsFile) fd.set("certificate", settingsFile);
      const headers = await authHeaders();
      const res = await fetch("/api/company/bank/settings", { method: "POST", headers, body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: "Uloženo", description: "Nastavení banky bylo uloženo." });
      setSettingsPassword("");
      setSettingsFile(null);
      await loadOverview();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Nastavení",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const testConnection = async () => {
    if (!companyId || !user) return;
    const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
    const res = await fetch("/api/company/bank/settings/test", {
      method: "POST",
      headers,
      body: JSON.stringify({ companyId }),
    });
    const json = await res.json();
    const httpStatus = json.httpStatus as number | undefined;
    const title = json.ok
      ? "Test připojení"
      : httpStatus != null && httpStatus > 0
        ? `Raiffeisenbank HTTP ${httpStatus}`
        : "Test připojení – chyba";
    const description =
      (typeof json.display === "string" && json.display.trim()) ||
      (typeof json.message === "string" && json.message.trim()) ||
      (typeof json.error === "string" && json.error.trim()) ||
      "Test spojení selhal.";
    toast({
      title,
      description,
      variant: json.ok ? "default" : "destructive",
    });
  };

  const unmatchedTxns = useMemo(
    () => transactions.filter((t) => t.classification === "unmatched" && (t.matchedAmountTotal ?? 0) <= 0),
    [transactions]
  );

  if (!access.canRead) {
    return (
      <p className="p-6 text-muted-foreground">Nemáte oprávnění k modulu Banka.</p>
    );
  }

  if (loading && !overview) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="h-6 w-6" />
          <h1 className="text-2xl font-semibold">Banka</h1>
        </div>
        {access.canWrite ? (
          <Button type="button" disabled={syncing} onClick={() => void syncNow()}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Synchronizovat nyní
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Přehled</TabsTrigger>
          <TabsTrigger value="accounts">Účty</TabsTrigger>
          <TabsTrigger value="transactions">Transakce</TabsTrigger>
          <TabsTrigger value="matching">Párování plateb</TabsTrigger>
          <TabsTrigger value="settings">Nastavení banky</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Příchozí tento měsíc</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold text-emerald-700">
                {formatMoney(overview?.summary.incomingMonth ?? 0, "CZK")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Odchozí tento měsíc</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {formatMoney(overview?.summary.outgoingMonth ?? 0, "CZK")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Nespárované</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">{overview?.summary.unmatchedCount ?? 0}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Poslední synchronizace</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {overview?.connection.lastSyncAt
                  ? new Date(overview.connection.lastSyncAt).toLocaleString("cs-CZ")
                  : "—"}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Bankovní účty</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(overview?.accounts ?? []).map((a) => (
                <div key={a.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm">
                  <span>{a.name ?? a.accountNumber ?? a.id}</span>
                  <span className="font-medium">{formatMoney(a.balance ?? 0, a.currency)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Název</TableHead>
                    <TableHead>Účet</TableHead>
                    <TableHead>Zůstatek</TableHead>
                    <TableHead>Disponibilní</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.accounts ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.name ?? "—"}</TableCell>
                      <TableCell>{a.accountNumber ?? a.id}</TableCell>
                      <TableCell>{formatMoney(a.balance ?? 0, a.currency)}</TableCell>
                      <TableCell>{formatMoney(a.availableBalance ?? a.balance ?? 0, a.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Fulltext" value={filterQ} onChange={(e) => setFilterQ(e.target.value)} className="max-w-xs" />
            <Input placeholder="VS" value={filterVs} onChange={(e) => setFilterVs(e.target.value)} className="max-w-[140px]" />
            <select
              className="rounded-md border px-2 py-2 text-sm"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
            >
              <option value="">Období</option>
              <option value="today">Dnes</option>
              <option value="week">Tento týden</option>
              <option value="month">Tento měsíc</option>
              <option value="prev_month">Minulý měsíc</option>
              <option value="last30">Posledních 30 dní</option>
            </select>
            <Button variant="outline" onClick={() => void loadTransactions()}>
              Filtrovat
            </Button>
            <Button variant="outline" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </div>
          <TransactionsTable rows={transactions} onDetail={access.canWrite ? loadSuggestions : undefined} />
        </TabsContent>

        <TabsContent value="matching" className="space-y-4">
          <TransactionsTable
            rows={unmatchedTxns}
            onDetail={access.canWrite ? loadSuggestions : undefined}
          />
          {selectedTxn && suggestions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Navržené párování</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {suggestions.map((s) => (
                  <div key={`${s.targetKind}-${s.targetId}`} className="flex items-center justify-between gap-2 border-b pb-2">
                    <span>
                      {s.label} ({s.confidence} %)
                    </span>
                    {access.canWrite ? (
                      <Button size="sm" onClick={() => void confirmMatch(s)}>
                        Potvrdit
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="settings">
          {access.canWrite ? (
            <Card>
              <CardHeader>
                <CardTitle>Raiffeisenbank Premium API</CardTitle>
              </CardHeader>
              <CardContent className="max-w-lg space-y-4">
                <p className="text-sm text-muted-foreground">
                  Certifikát .p12 zůstává pouze na serveru. ClientID:{" "}
                  {overview?.connection.clientIdMasked ?? "—"}
                </p>
                <div>
                  <Label>ClientID</Label>
                  <Input value={settingsClientId} onChange={(e) => setSettingsClientId(e.target.value)} />
                </div>
                <div>
                  <Label>Certifikát .p12</Label>
                  <Input
                    type="file"
                    accept=".p12,.pfx"
                    onChange={(e) => setSettingsFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div>
                  <Label>Heslo certifikátu</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={settingsPassword}
                    onChange={(e) => setSettingsPassword(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button disabled={savingSettings} onClick={() => void saveSettings()}>
                    {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit"}
                  </Button>
                  <Button variant="outline" onClick={() => void testConnection()}>
                    Otestovat spojení
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Nastavení integrace smí měnit pouze administrátor.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TransactionsTable({
  rows,
  onDetail,
}: {
  rows: TxRow[];
  onDetail?: (id: string) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Protistrana</TableHead>
              <TableHead>VS</TableHead>
              <TableHead>Popis</TableHead>
              <TableHead>Částka</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.bookingDate}</TableCell>
                <TableCell>
                  <Badge variant={t.direction === "incoming" ? "default" : "secondary"}>
                    {t.direction === "incoming" ? "Příchozí" : "Odchozí"}
                  </Badge>
                </TableCell>
                <TableCell>{t.counterpartyName ?? "—"}</TableCell>
                <TableCell>{t.variableSymbol ?? "—"}</TableCell>
                <TableCell className="max-w-[200px] truncate">{t.message ?? "—"}</TableCell>
                <TableCell className={t.amount >= 0 ? "text-emerald-700 font-medium" : ""}>
                  {formatMoney(t.amount, t.currency)}
                </TableCell>
                <TableCell>{t.classification}</TableCell>
                <TableCell>
                  {onDetail ? (
                    <Button size="sm" variant="ghost" onClick={() => onDetail(t.id)}>
                      Spárovat
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
