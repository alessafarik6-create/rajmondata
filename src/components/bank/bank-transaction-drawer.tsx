"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { BankMatchStatusBadge } from "@/components/bank/bank-match-status-badge";
import { formatBankMoney } from "@/components/bank/bank-utils";
import { confidenceBand } from "@/lib/bank/match-display";
import type { BankSuggestedMatch } from "@/lib/bank/types";

type MatchRow = {
  id: string;
  invoiceId?: string | null;
  documentId?: string | null;
  matchedAmount: number;
  targetLabel?: string | null;
};

type TxDetail = {
  id: string;
  accountLabel: string;
  bookingDate: string;
  valueDate?: string | null;
  amount: number;
  currency: string;
  direction: string;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  specificSymbol?: string | null;
  message?: string | null;
  reference?: string | null;
  externalTransactionId: string;
  classification: string;
  matchStatus?: string | null;
  matchedAmountTotal: number;
  note: string;
  suggestedMatches: BankSuggestedMatch[];
  matches: MatchRow[];
};

type HistoryRow = {
  id: string;
  actionType?: string;
  actionLabel?: string;
  createdAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type Suggestion = BankSuggestedMatch & { targetKind: string };

export function BankTransactionDrawer({
  open,
  onOpenChange,
  transactionId,
  companyId,
  canWrite,
  getAuthHeaders,
  onChanged,
  initialPanel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  transactionId: string | null;
  companyId: string;
  canWrite: boolean;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChanged: () => void;
  initialPanel?: "detail" | "match";
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [matchOpen, setMatchOpen] = useState(initialPanel === "match");
  const [confirm, setConfirm] = useState<{
    suggestion: Suggestion;
    amount: number;
  } | null>(null);
  const [unmatchId, setUnmatchId] = useState<string | null>(null);

  const remaining = useMemo(() => {
    if (!detail) return 0;
    return Math.max(0, Math.abs(detail.amount) - (detail.matchedAmountTotal ?? 0));
  }, [detail]);

  const loadDetail = useCallback(async () => {
    if (!transactionId || !companyId) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/company/bank/transactions/${encodeURIComponent(transactionId)}?companyId=${encodeURIComponent(companyId)}`,
        { headers }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Načtení selhalo.");
      setDetail(json.transaction as TxDetail);
      setNoteDraft(String(json.transaction.note ?? ""));
      setHistory(json.history ?? []);
      const stored = (json.transaction.suggestedMatches ?? []) as BankSuggestedMatch[];
      if (stored.length) {
        setSuggestions(
          stored.map((s) => ({ ...s, targetKind: s.targetKind }))
        );
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Transakce",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setLoading(false);
    }
  }, [transactionId, companyId, getAuthHeaders, toast]);

  useEffect(() => {
    if (open && transactionId) {
      void loadDetail();
      setMatchOpen(initialPanel === "match");
    }
  }, [open, transactionId, loadDetail, initialPanel]);

  const loadSuggestions = async () => {
    if (!transactionId || !companyId) return;
    setLoadingSuggestions(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/company/bank/suggestions?companyId=${encodeURIComponent(companyId)}&transactionId=${encodeURIComponent(transactionId)}`,
        { headers }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Návrhy selhaly.");
      setSuggestions(json.suggestions ?? []);
      setAiSummary(json.aiSummary ?? null);
      setMatchOpen(true);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "AI návrhy",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const saveNote = async () => {
    if (!canWrite || !transactionId) return;
    setSavingNote(true);
    try {
      const headers = {
        ...(await getAuthHeaders()),
        "Content-Type": "application/json",
      };
      const res = await fetch(
        `/api/company/bank/transactions/${encodeURIComponent(transactionId)}/note`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ companyId, note: noteDraft }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      toast({ title: "Poznámka uložena" });
      await loadDetail();
      onChanged();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Poznámka",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setSavingNote(false);
    }
  };

  const submitMatch = async () => {
    if (!confirm || !transactionId || !canWrite) return;
    const s = confirm.suggestion;
    const headers = {
      ...(await getAuthHeaders()),
      "Content-Type": "application/json",
    };
    const res = await fetch("/api/company/bank/match", {
      method: "POST",
      headers,
      body: JSON.stringify({
        companyId,
        transactionId,
        matchedAmount: confirm.amount,
        matchType: "manual",
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
    setConfirm(null);
    await loadDetail();
    onChanged();
  };

  const doUnmatch = async () => {
    if (!unmatchId || !canWrite) return;
    const headers = await getAuthHeaders();
    const res = await fetch(
      `/api/company/bank/match/${encodeURIComponent(unmatchId)}?companyId=${encodeURIComponent(companyId)}`,
      { method: "DELETE", headers }
    );
    const json = await res.json();
    if (!json.ok) {
      toast({ variant: "destructive", title: "Zrušení párování", description: json.error });
      return;
    }
    toast({ title: "Spárování zrušeno" });
    setUnmatchId(null);
    await loadDetail();
    onChanged();
  };

  const targetHref = (s: Suggestion) =>
    s.targetKind === "issued_invoice"
      ? `/portal/invoices/${encodeURIComponent(s.targetId)}`
      : `/portal/documents?highlight=${encodeURIComponent(s.targetId)}`;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detail transakce</SheetTitle>
          </SheetHeader>
          {loading || !detail ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="mt-4 space-y-6 pb-8">
              <div className="space-y-1">
                <p className="text-2xl font-semibold">{formatBankMoney(detail.amount, detail.currency)}</p>
                <p className="text-sm text-muted-foreground">{detail.bookingDate}</p>
                <BankMatchStatusBadge
                  classification={detail.classification}
                  matchedAmountTotal={detail.matchedAmountTotal}
                  amount={detail.amount}
                  matchStatus={detail.matchStatus}
                  suggestedMatches={detail.suggestedMatches}
                />
              </div>

              <dl className="grid grid-cols-1 gap-2 text-sm">
                <Row label="Typ" value={detail.direction === "incoming" ? "Příchozí" : "Odchozí"} />
                <Row label="Protistrana" value={detail.counterpartyName} />
                <Row label="Účet protistrany" value={detail.counterpartyAccount} />
                <Row label="VS" value={detail.variableSymbol} />
                <Row label="KS" value={detail.constantSymbol} />
                <Row label="SS" value={detail.specificSymbol} />
                <Row label="Popis" value={detail.message} />
                <Row label="Reference" value={detail.reference ?? detail.externalTransactionId} />
                <Row label="Bankovní účet" value={detail.accountLabel} />
              </dl>

              {detail.matches.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium text-sm">Spárováno s</p>
                  {detail.matches.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                      <span>
                        {m.targetLabel ?? m.invoiceId ?? m.documentId} —{" "}
                        {formatBankMoney(m.matchedAmount, detail.currency)}
                      </span>
                      <div className="flex gap-2">
                        {m.invoiceId ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/portal/invoices/${m.invoiceId}`}>Otevřít fakturu</Link>
                          </Button>
                        ) : null}
                        {m.documentId ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/portal/documents?highlight=${m.documentId}`}>Otevřít doklad</Link>
                          </Button>
                        ) : null}
                        {canWrite ? (
                          <Button size="sm" variant="ghost" onClick={() => setUnmatchId(m.id)}>
                            Zrušit spárování
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Poznámka</Label>
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  disabled={!canWrite}
                  rows={3}
                  placeholder="Interní poznámka pro účetní…"
                />
                {canWrite ? (
                  <Button size="sm" disabled={savingNote} onClick={() => void saveNote()}>
                    {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uložit poznámku"}
                  </Button>
                ) : null}
              </div>

              {canWrite && remaining > 0.009 ? (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Spárování transakce</p>
                    <Button size="sm" variant="outline" disabled={loadingSuggestions} onClick={() => void loadSuggestions()}>
                      {loadingSuggestions ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Sparkles className="mr-1 h-4 w-4" /> Najít shodu pomocí AI
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Zbývá spárovat: {formatBankMoney(remaining, detail.currency)}
                  </p>
                  {aiSummary ? <p className="text-sm text-muted-foreground">{aiSummary}</p> : null}
                  {matchOpen && suggestions.length > 0 ? (
                    <ul className="space-y-3">
                      {suggestions.map((s) => (
                        <li key={`${s.targetKind}-${s.targetId}`} className="rounded border p-3 text-sm space-y-2">
                          <div className="font-medium">{s.label}</div>
                          <div>
                            {s.amount != null ? formatBankMoney(s.amount, s.currency ?? detail.currency) : null}
                            {s.variableSymbol ? ` · VS ${s.variableSymbol}` : null}
                          </div>
                          <div>
                            Shoda: <strong>{s.confidence} %</strong> — {confidenceBand(s.confidence)}
                          </div>
                          <ul className="text-xs text-muted-foreground list-disc pl-4">
                            {s.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={targetHref(s)} target="_blank">
                                Zobrazit doklad
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                setConfirm({
                                  suggestion: s,
                                  amount: Math.min(remaining, Math.abs(s.amount ?? remaining)),
                                })
                              }
                            >
                              Spárovat
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : matchOpen ? (
                    <p className="text-sm text-muted-foreground">Žádné návrhy — zkuste AI vyhledání.</p>
                  ) : null}
                </div>
              ) : null}

              {history.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-medium text-sm">Historie</p>
                  <ul className="space-y-2 text-xs text-muted-foreground">
                    {history.map((h) => (
                      <li key={h.id}>
                        {h.createdAt ? new Date(h.createdAt).toLocaleString("cs-CZ") : "—"} —{" "}
                        {String(h.actionLabel ?? h.actionType ?? "Událost")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Potvrdit spárování</DialogTitle>
          </DialogHeader>
          {confirm && detail ? (
            <div className="space-y-3 text-sm">
              <p>Chystáte se spárovat:</p>
              <p>
                <strong>Bankovní transakce:</strong> {formatBankMoney(detail.amount, detail.currency)},{" "}
                {detail.bookingDate}
              </p>
              <p>
                <strong>Doklad:</strong> {confirm.suggestion.label}
              </p>
              <div>
                <Label>Spárovaná částka</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={confirm.amount}
                  onChange={(e) =>
                    setConfirm({
                      ...confirm,
                      amount: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Zrušit
            </Button>
            <Button onClick={() => void submitMatch()}>Potvrdit spárování</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unmatchId} onOpenChange={(v) => !v && setUnmatchId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zrušit spárování?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Vazba bude odstraněna a platební stav faktury/dokladu se přepočítá.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatchId(null)}>
              Ne
            </Button>
            <Button variant="destructive" onClick={() => void doUnmatch()}>
              Ano, zrušit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value?.trim() ? value : "—"}</dd>
    </div>
  );
}
