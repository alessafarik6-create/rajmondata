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
import { Loader2, RefreshCw, Landmark, ChevronRight } from "lucide-react";
import { downloadCsvFromRows } from "@/lib/csv-download";
import { logPortalExportAudit } from "@/lib/portal-export-audit-client";
import { useToast } from "@/hooks/use-toast";
import { BankTransactionsTable, BankAccountRowLink } from "@/components/bank/bank-transactions-table";
import { BankTransactionDrawer } from "@/components/bank/bank-transaction-drawer";
import { formatBankMoney, type BankTxListRow } from "@/components/bank/bank-utils";
import { resolveBankMatchUiState } from "@/lib/bank/match-display";

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

export function BankPortalPage() {
  const { user } = useUser();
  const { companyId } = useCompany();
  const access = usePortalModuleAccess("bank");
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [transactions, setTransactions] = useState<BankTxListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterQ, setFilterQ] = useState("");
  const [filterVs, setFilterVs] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [matchState, setMatchState] = useState("");
  const [settingsClientId, setSettingsClientId] = useState("");
  const [settingsPassword, setSettingsPassword] = useState("");
  const [settingsFile, setSettingsFile] = useState<File | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [drawerTxn, setDrawerTxn] = useState<string | null>(null);
  const [drawerMatchMode, setDrawerMatchMode] = useState(false);

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
    if (matchState) params.set("matchState", matchState);
    const res = await fetch(`/api/company/bank/transactions?${params}`, { headers });
    const json = await res.json();
    if (json.ok) setTransactions(json.transactions ?? []);
  }, [user, companyId, access.canRead, authHeaders, filterQ, filterVs, datePreset, matchState]);

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

  useEffect(() => {
    if (!loading) void loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtr stavu párování
  }, [matchState]);

  const openTransaction = (id: string, matchPanel?: boolean) => {
    setDrawerTxn(id);
    setDrawerMatchMode(!!matchPanel);
  };

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
        if (json.partialSuccess) {
          toast({
            variant: "destructive",
            title: "Synchronizace — transakce",
            description: msg,
          });
          await reload();
          return;
        }
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
      ["Datum", "Typ", "Protistrana", "VS", "Popis", "Částka", "Měna"],
      ...transactions.map((t) => [
        t.bookingDate,
        t.direction === "incoming" ? "Příchozí" : "Odchozí",
        t.counterpartyName ?? "",
        t.variableSymbol ?? "",
        t.message ?? "",
        String(t.amount),
        t.currency,
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

  const testTransactions = async () => {
    if (!companyId || !user) return;
    const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
    const res = await fetch("/api/company/bank/settings/test-transactions", {
      method: "POST",
      headers,
      body: JSON.stringify({ companyId }),
    });
    const json = await res.json();
    toast({
      title: json.ok ? "Test transakcí" : `Transakce HTTP ${json.httpStatus ?? "?"}`,
      description: json.message ?? json.error ?? "Hotovo.",
      variant: json.ok ? "default" : "destructive",
    });
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
    () =>
      transactions.filter(
        (t) =>
          resolveBankMatchUiState({
            classification: t.classification,
            matchedAmountTotal: t.matchedAmountTotal,
            amount: t.amount,
            matchStatus: t.matchStatus as "unmatched" | "review" | "matched" | null,
            suggestedMatches: t.suggestedMatches as import("@/lib/bank/types").BankSuggestedMatch[] | null,
          }) === "unmatched"
      ),
    [transactions]
  );

  const filterChips = (
    <div className="flex flex-wrap gap-2">
      {[
        { v: "", label: "Vše" },
        { v: "unmatched", label: "? Nespárované" },
        { v: "review", label: "! Ke kontrole" },
        { v: "matched", label: "✓ Spárováno" },
      ].map((chip) => (
        <Button
          key={chip.v || "all"}
          size="sm"
          variant={matchState === chip.v ? "default" : "outline"}
          onClick={() => {
            setMatchState(chip.v);
          }}
        >
          {chip.label}
        </Button>
      ))}
      <span className="self-center text-sm text-muted-foreground">
        Nespárované: {overview?.summary.unmatchedCount ?? unmatchedTxns.length}
      </span>
    </div>
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
                {formatBankMoney(overview?.summary.incomingMonth ?? 0, "CZK")}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Odchozí tento měsíc</CardTitle>
              </CardHeader>
              <CardContent className="text-lg font-semibold">
                {formatBankMoney(overview?.summary.outgoingMonth ?? 0, "CZK")}
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
                <BankAccountRowLink
                  key={a.id}
                  accountId={a.id}
                  className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm hover:text-primary"
                >
                  <span>{a.name ?? a.accountNumber ?? a.id}</span>
                  <span className="font-medium">{formatBankMoney(a.balance, a.currency)}</span>
                </BankAccountRowLink>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <div className="md:hidden space-y-2">
            {(overview?.accounts ?? []).map((a) => (
              <BankAccountRowLink key={a.id} accountId={a.id}>
                <Card className="hover:border-primary/40">
                  <CardContent className="p-4 flex justify-between items-center">
                    <div>
                      <p className="font-medium">{a.name ?? "Účet"}</p>
                      <p className="text-sm text-muted-foreground">{a.accountNumber ?? a.id}</p>
                      <p className="text-lg font-semibold mt-1">{formatBankMoney(a.balance, a.currency)}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </CardContent>
                </Card>
              </BankAccountRowLink>
            ))}
          </div>
          <Card className="hidden md:block">
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Název</TableHead>
                    <TableHead>Účet</TableHead>
                    <TableHead>Zůstatek</TableHead>
                    <TableHead>Disponibilní</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.accounts ?? []).map((a) => (
                    <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell colSpan={5} className="p-0">
                        <BankAccountRowLink
                          accountId={a.id}
                          className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2 px-4 py-3 w-full"
                        >
                          <span>{a.name ?? "—"}</span>
                          <span>{a.accountNumber ?? a.id}</span>
                          <span>{formatBankMoney(a.balance, a.currency)}</span>
                          <span>{formatBankMoney(a.availableBalance ?? a.balance, a.currency)}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground justify-self-end" />
                        </BankAccountRowLink>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          {filterChips}
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
          <BankTransactionsTable
            rows={transactions}
            onOpenTransaction={(id) => openTransaction(id)}
            showMatchAction={access.canWrite}
          />
        </TabsContent>

        <TabsContent value="matching" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Nespárované transakce — otevřete detail a potvrďte párování ručně.
          </p>
          <BankTransactionsTable
            rows={unmatchedTxns}
            onOpenTransaction={(id) => openTransaction(id, true)}
            showMatchAction={access.canWrite}
          />
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
                  <Button variant="outline" onClick={() => void testTransactions()}>
                    Test transakcí
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Nastavení integrace smí měnit pouze administrátor.</p>
          )}
        </TabsContent>
      </Tabs>

      {companyId && user ? (
        <BankTransactionDrawer
          open={!!drawerTxn}
          onOpenChange={(v) => {
            if (!v) {
              setDrawerTxn(null);
              setDrawerMatchMode(false);
            }
          }}
          transactionId={drawerTxn}
          companyId={companyId}
          canWrite={access.canWrite}
          getAuthHeaders={authHeaders}
          onChanged={() => void reload()}
          initialPanel={drawerMatchMode ? "match" : "detail"}
        />
      ) : null}
    </div>
  );
}
