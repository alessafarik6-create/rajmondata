"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatWorkIntentStatus } from "@/lib/company-chat-types";
import Link from "next/link";
import { Brain, Loader2, Pencil, Sparkles, X } from "lucide-react";
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

  const applySelected = useCallback(async () => {
    if (!user || !analysis || selectedCount === 0) return;
    setApplying(true);
    setError(null);
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
          proposals,
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
  }, [user, analysis, selected, selectedCount, visibleProposals, proposals, props]);

  const jobProposalCount = visibleProposals.filter((p) => p.kind === "new_job").length;

  return (
    <div className="mt-2 space-y-2">
      {!analysis ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5 border-sky-500/40 text-sky-100 hover:bg-sky-500/15"
          disabled={loading || !props.canAnalyze}
          onClick={() => void runAnalyze()}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Brain className="h-3.5 w-3.5" />
          )}
          {loading ? "Analyzuji…" : "Analyzovat pomocí AI"}
        </Button>
      ) : null}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      {analysis && visibleProposals.length > 0 ? (
        <div className="rounded-lg border border-sky-500/35 bg-sky-950/40 px-2.5 py-2 text-[11px] text-sky-50 space-y-2">
          <p className="font-medium flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5" />
            {analysis.summaryCs}
          </p>
          {jobProposalCount > 0 ? (
            <p>
              Našla jsem {jobProposalCount}{" "}
              {jobProposalCount === 1
                ? "možnou zakázku"
                : jobProposalCount < 5
                  ? "možné zakázky"
                  : "možných zakázek"}
              . Chcete je připravit k vytvoření?
            </p>
          ) : null}

          <ul className="space-y-2">
            {visibleProposals.map((p) => {
              const on = selected.has(p.proposalId);
              return (
                <li
                  key={p.proposalId}
                  className={cn(
                    "rounded-md border p-2 space-y-1",
                    on ? "border-sky-400/50 bg-sky-900/30" : "border-sky-700/40 opacity-80"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-1">
                    <div>
                      <p className="font-semibold">{proposalTitle(p)}</p>
                      <p className="text-sky-200/80">
                        {p.customerName || p.companyName || "—"}
                        {p.scheduledDate ? ` · ${p.scheduledDate}` : ""}
                      </p>
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
              className="w-full h-8 text-xs bg-sky-600 hover:bg-sky-700"
              disabled={applying || selectedCount === 0}
              onClick={() => void applySelected()}
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
              <div className="space-y-1">
                <Label>Datum (YYYY-MM-DD)</Label>
                <Input
                  value={editProposal.scheduledDate ?? ""}
                  onChange={(e) =>
                    setEditProposal({ ...editProposal, scheduledDate: e.target.value })
                  }
                />
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
    </div>
  );
}
