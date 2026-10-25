"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatWorkIntentStatus } from "@/lib/company-chat-types";
import Link from "next/link";
import { Brain, CalendarDays, Loader2, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/firebase";
import { cn } from "@/lib/utils";
import type { ChatAttachmentMeta } from "@/lib/company-chat-types";
import type {
  ChatWorkIntentAnalysisDoc,
  ChatWorkIntentProposal,
} from "@/lib/chat/chat-work-intent-types";

const KIND_LABEL: Record<string, string> = {
  new_job: "Nová zakázka",
  task: "Úkol",
  meeting: "Schůzka",
  note_to_job: "Poznámka k zakázce",
  unclear: "Nejasné",
};

function proposalTitle(p: ChatWorkIntentProposal): string {
  return (
    String(p.jobTitle ?? "").trim() ||
    String(p.description ?? "").trim().slice(0, 60) ||
    KIND_LABEL[p.kind] ||
    "Návrh"
  );
}

export function ChatWorkIntentPanel(props: {
  companyId: string;
  messageId: string;
  messageText: string;
  attachments: ChatAttachmentMeta[];
  attachmentIds?: string[];
  canAnalyze: boolean;
  canApplyJobs: boolean;
  initialAnalysisId?: string | null;
  workIntentStatus?: ChatWorkIntentStatus;
  onPatched?: () => void;
}) {
  const { user } = useUser();
  const attachmentIds = props.attachmentIds ?? props.attachments.map((a) => a.id);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ChatWorkIntentAnalysisDoc | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [editProposal, setEditProposal] = useState<ChatWorkIntentProposal | null>(null);
  const [proposals, setProposals] = useState<ChatWorkIntentProposal[]>([]);
  const [applyResults, setApplyResults] = useState<
    Array<{ proposalId: string; jobId?: string; jobName?: string; ok: boolean; error?: string }>
  | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<"jobs" | "meetings" | "tasks">("jobs");

  const visibleProposals = useMemo(
    () => proposals.filter((p) => !excluded.has(p.proposalId)),
    [proposals, excluded]
  );

  const selectedCount = useMemo(
    () => visibleProposals.filter((p) => selected.has(p.proposalId)).length,
    [visibleProposals, selected]
  );

  useEffect(() => {
    const aid = String(props.initialAnalysisId ?? "").trim();
    if (!user || !aid || analysis?.id === aid) return;
    if (props.workIntentStatus !== "ready" && props.workIntentStatus !== "applied") return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const q = new URLSearchParams({ analysisId: aid });
        const res = await fetch(`/api/company/chat/work-intent-analysis?${q}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as {
          ok?: boolean;
          analysis?: ChatWorkIntentAnalysisDoc;
        };
        if (cancelled || !res.ok || !data.ok || !data.analysis?.readable) return;
        setAnalysis(data.analysis);
        setProposals(data.analysis.proposals ?? []);
        setSelected(new Set((data.analysis.proposals ?? []).map((p) => p.proposalId)));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, props.initialAnalysisId, props.workIntentStatus, analysis?.id]);

  const runAnalyze = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    setApplyResults(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/chat/analyze-work-intent", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: props.companyId,
          messageId: props.messageId,
          attachmentIds,
          force: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        analysis?: ChatWorkIntentAnalysisDoc;
      };
      if (!res.ok || !data.ok || !data.analysis) {
        throw new Error(data.error ?? "Analýza se nezdařila.");
      }
      if (!data.analysis.readable) {
        throw new Error(data.analysis.unreadableReason ?? "Obsah nelze přečíst.");
      }
      setAnalysis(data.analysis);
      setProposals(data.analysis.proposals ?? []);
      setSelected(new Set((data.analysis.proposals ?? []).map((p) => p.proposalId)));
      setExcluded(new Set());
      props.onPatched?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba analýzy.");
    } finally {
      setLoading(false);
    }
  }, [user, props, attachmentIds]);

  const proposalsForApply = useMemo(() => {
    return proposals.map((p) => {
      if (!selected.has(p.proposalId) || excluded.has(p.proposalId)) return p;
      if (applyMode === "meetings") return { ...p, kind: "meeting" as const };
      if (applyMode === "tasks") return { ...p, kind: "task" as const };
      return { ...p, kind: "new_job" as const };
    });
  }, [proposals, selected, excluded, applyMode]);

  const applySelected = useCallback(async () => {
    if (!user || !analysis || selectedCount === 0) return;
    setApplying(true);
    setError(null);
    setBulkOpen(false);
    try {
      const token = await user.getIdToken();
      const idempotencyKey = `apply_${analysis.id}_${Date.now()}`;
      const res = await fetch("/api/company/chat/apply-work-intent", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId: props.companyId,
          messageId: props.messageId,
          analysisId: analysis.id,
          idempotencyKey,
          selectedProposalIds: [...selected].filter((id) =>
            visibleProposals.some((p) => p.proposalId === id)
          ),
          proposals: proposalsForApply,
          createMissingCustomers: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        results?: Array<{
          proposalId: string;
          ok: boolean;
          error?: string;
          jobId?: string;
          jobName?: string;
        }>;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Uložení se nezdařilo.");
      }
      setApplyResults(data.results ?? []);
      props.onPatched?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba uložení.");
    } finally {
      setApplying(false);
    }
  }, [user, analysis, selected, selectedCount, visibleProposals, proposalsForApply, props]);

  const itemCount = visibleProposals.length;
  const isReservationDoc = analysis?.documentType === "reservation_schedule";

  const analyzeDisabledReason = !props.canAnalyze
    ? "AI analýza vyžaduje oprávnění administrace."
    : null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className={cn(
            "h-9 text-xs gap-1.5 font-semibold",
            "bg-orange-600 text-white hover:bg-orange-700",
            "disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          )}
          disabled={loading || !props.canAnalyze}
          title={analyzeDisabledReason ?? undefined}
          onClick={() => void runAnalyze()}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
          ) : (
            <Brain className="h-3.5 w-3.5 text-white" />
          )}
          {loading ? "Analyzuji obrázek…" : "Analyzovat pomocí AI"}
        </Button>
        {analysis ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 text-xs"
            disabled={loading}
            onClick={() => void runAnalyze()}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Znovu
          </Button>
        ) : null}
      </div>

      {analyzeDisabledReason ? (
        <p className="text-[10px] text-muted-foreground">{analyzeDisabledReason}</p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive flex flex-wrap items-center gap-2">
          <span>{error}</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => void runAnalyze()}>
            Opakovat
          </Button>
        </div>
      ) : null}

      {analysis && visibleProposals.length > 0 ? (
        <div className="rounded-lg border border-orange-500/30 bg-orange-50/90 dark:bg-orange-950/30 px-2.5 py-2 text-[11px] space-y-2">
          <p className="font-medium flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            {analysis.summaryCs}
          </p>
          {isReservationDoc && itemCount > 0 ? (
            <p>
              Rozpoznala jsem {itemCount}{" "}
              {itemCount === 1 ? "termín rezervace" : itemCount < 5 ? "termíny rezervací" : "termínů rezervací"}.
              Zvolte, zda vytvořit zakázky, události v kalendáři nebo úkoly.
            </p>
          ) : itemCount > 0 ? (
            <p>Našla jsem {itemCount} samostatných položek. Zkontrolujte a upravte před uložením.</p>
          ) : null}

          {analysis.extractedTextPreview ? (
            <details className="text-[10px] opacity-90">
              <summary className="cursor-pointer font-medium">Rozpoznaný text z obrázku</summary>
              <pre className="mt-1 whitespace-pre-wrap font-sans">{analysis.extractedTextPreview}</pre>
            </details>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={applyMode === "jobs" ? "default" : "outline"}
              className="h-7 text-[10px]"
              onClick={() => setApplyMode("jobs")}
            >
              {itemCount} zakázek
            </Button>
            <Button
              type="button"
              size="sm"
              variant={applyMode === "meetings" ? "default" : "outline"}
              className="h-7 text-[10px] gap-1"
              onClick={() => setApplyMode("meetings")}
            >
              <CalendarDays className="h-3 w-3" />
              Kalendář
            </Button>
            <Button
              type="button"
              size="sm"
              variant={applyMode === "tasks" ? "default" : "outline"}
              className="h-7 text-[10px]"
              onClick={() => setApplyMode("tasks")}
            >
              Úkoly
            </Button>
          </div>

          <ul className="space-y-2">
            {visibleProposals.map((p) => {
              const on = selected.has(p.proposalId);
              return (
                <li
                  key={p.proposalId}
                  className={cn(
                    "rounded-md border p-2 space-y-1",
                    on ? "border-orange-400/60 bg-orange-100/50 dark:bg-orange-900/20" : "border-border opacity-80",
                    p.overlapWarning && "ring-1 ring-amber-500"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-1">
                    <div>
                      <p className="font-semibold">{proposalTitle(p)}</p>
                      <p className="text-muted-foreground">
                        {p.customerName || p.companyName || "—"}
                        {p.scheduledDate
                          ? ` · ${p.scheduledDate}${p.scheduledEndDate ? ` – ${p.scheduledEndDate}` : ""}`
                          : ""}
                        {p.dateNeedsConfirmation ? " · rok k potvrzení" : ""}
                      </p>
                      {p.sourceQuote ? (
                        <p className="text-[10px] text-muted-foreground italic">{p.sourceQuote}</p>
                      ) : null}
                      {p.overlapWarning ? (
                        <p className="text-[10px] text-amber-700 dark:text-amber-300">
                          Překrývající se termín
                        </p>
                      ) : null}
                      <Badge variant="outline" className="mt-1 h-5 text-[9px]">
                        {KIND_LABEL[p.kind] ?? p.kind}
                      </Badge>
                      {p.completionStatus === "needs_input" ? (
                        <Badge variant="secondary" className="ml-1 h-5 text-[9px]">
                          Nutno doplnit
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => setEditProposal(p)}
                      >
                        <Pencil className="h-3 w-3 mr-0.5" /> Upravit
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Vyřadit"
                        onClick={() => {
                          setExcluded((s) => new Set(s).add(p.proposalId));
                          setSelected((s) => {
                            const n = new Set(s);
                            n.delete(p.proposalId);
                            return n;
                          });
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {p.description ? (
                    <p className="text-sky-100/70 line-clamp-2">{p.description}</p>
                  ) : null}
                  {p.customerMatch ? (
                    <p className="text-emerald-300/90">
                      Propojit zákazníka: {p.customerMatch.label} ({p.customerMatch.matchReason})
                    </p>
                  ) : null}
                  {p.jobMatches && p.jobMatches.length > 0 ? (
                    <p className="text-amber-200/90 text-[10px]">
                      Možná existující zakázka: {p.jobMatches[0]!.name}
                    </p>
                  ) : null}
                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(p.proposalId)) n.delete(p.proposalId);
                          else n.add(p.proposalId);
                          return n;
                        })
                      }
                    />
                    <span>Zahrnout při vytváření</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {props.canApplyJobs ? (
            <Button
              type="button"
              size="sm"
              className="w-full h-9 text-xs bg-orange-600 hover:bg-orange-700 text-white"
              disabled={applying || selectedCount === 0}
              onClick={() => setBulkOpen(true)}
            >
              {applying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                `Zkontrolovat a vytvořit (${selectedCount})`
              )}
            </Button>
          ) : (
            <p className="text-[10px] text-sky-200/70">Vytvoření vyžaduje oprávnění k zakázkám.</p>
          )}
        </div>
      ) : null}

      {applyResults?.length ? (
        <ul className="text-[11px] space-y-1">
          {applyResults.map((r) => (
            <li key={r.proposalId}>
              {r.ok && r.jobId ? (
                <span className="text-emerald-300">
                  Vytvořeno:{" "}
                  <Link href={`/portal/jobs/${encodeURIComponent(r.jobId)}`} className="underline">
                    {r.jobName ?? r.jobId}
                  </Link>
                </span>
              ) : r.ok ? (
                <span className="text-emerald-300">Uloženo ({r.proposalId})</span>
              ) : (
                <span className="text-destructive">{r.error ?? "Chyba"}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={!!editProposal} onOpenChange={(o) => !o && setEditProposal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upravit návrh</DialogTitle>
          </DialogHeader>
          {editProposal ? (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <Label>Název / zakázka</Label>
                <Input
                  value={editProposal.jobTitle ?? ""}
                  onChange={(e) =>
                    setEditProposal({ ...editProposal, jobTitle: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Zákazník</Label>
                <Input
                  value={editProposal.customerName ?? editProposal.companyName ?? ""}
                  onChange={(e) =>
                    setEditProposal({
                      ...editProposal,
                      customerName: e.target.value,
                      companyName: e.target.value,
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>E-mail</Label>
                  <Input
                    value={editProposal.email ?? ""}
                    onChange={(e) => setEditProposal({ ...editProposal, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Telefon</Label>
                  <Input
                    value={editProposal.phone ?? ""}
                    onChange={(e) => setEditProposal({ ...editProposal, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Adresa</Label>
                <Input
                  value={editProposal.address ?? ""}
                  onChange={(e) => setEditProposal({ ...editProposal, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Zahájení (YYYY-MM-DD)</Label>
                  <Input
                    value={editProposal.scheduledDate ?? ""}
                    onChange={(e) =>
                      setEditProposal({ ...editProposal, scheduledDate: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Dokončení (YYYY-MM-DD)</Label>
                  <Input
                    value={editProposal.scheduledEndDate ?? ""}
                    onChange={(e) =>
                      setEditProposal({ ...editProposal, scheduledEndDate: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Popis</Label>
                <Textarea
                  value={editProposal.description ?? ""}
                  onChange={(e) =>
                    setEditProposal({ ...editProposal, description: e.target.value })
                  }
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditProposal(null)}>
              Zrušit
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!editProposal) return;
                setProposals((list) =>
                  list.map((x) => (x.proposalId === editProposal.proposalId ? editProposal : x))
                );
                setEditProposal(null);
              }}
            >
              Uložit úpravy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hromadná kontrola ({selectedCount} položek)</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Typ uložení:{" "}
            {applyMode === "jobs" ? "zakázky" : applyMode === "meetings" ? "kalendář" : "úkoly"}
          </p>
          <ul className="space-y-3 text-sm">
            {visibleProposals
              .filter((p) => selected.has(p.proposalId))
              .map((p) => (
                <li key={p.proposalId} className="rounded-md border p-2 space-y-2">
                  <Input
                    value={p.jobTitle ?? ""}
                    onChange={(e) =>
                      setProposals((list) =>
                        list.map((x) =>
                          x.proposalId === p.proposalId ? { ...x, jobTitle: e.target.value } : x
                        )
                      )
                    }
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Zahájení"
                      value={p.scheduledDate ?? ""}
                      onChange={(e) =>
                        setProposals((list) =>
                          list.map((x) =>
                            x.proposalId === p.proposalId
                              ? { ...x, scheduledDate: e.target.value }
                              : x
                          )
                        )
                      }
                    />
                    <Input
                      placeholder="Dokončení"
                      value={p.scheduledEndDate ?? ""}
                      onChange={(e) =>
                        setProposals((list) =>
                          list.map((x) =>
                            x.proposalId === p.proposalId
                              ? { ...x, scheduledEndDate: e.target.value }
                              : x
                          )
                        )
                      }
                    />
                  </div>
                  <Input
                    placeholder="Zákazník"
                    value={p.customerName ?? p.companyName ?? ""}
                    onChange={(e) =>
                      setProposals((list) =>
                        list.map((x) =>
                          x.proposalId === p.proposalId
                            ? { ...x, customerName: e.target.value, companyName: e.target.value }
                            : x
                        )
                      )
                    }
                  />
                </li>
              ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              Zpět
            </Button>
            <Button
              type="button"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={applying}
              onClick={() => void applySelected()}
            >
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdit a vytvořit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
