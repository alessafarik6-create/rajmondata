"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useUser } from "@/firebase";
import { csvMaterialDraftDocId } from "@/lib/csv-material-draft-id";
import type { InventoryItemRow } from "@/lib/inventory-types";
import {
  lengthToMillimeters,
  millimetersToUnit,
} from "@/lib/job-production-settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CsvMaterialDialogSource = {
  jobId: string;
  folderId: string;
  jobFolderImageId: string;
  fileUrl: string;
  fileName: string;
};

export type CsvDraftLine = {
  id: string;
  csvLabel: string;
  inventoryItemId: string | null;
  quantity: number;
  inputLengthUnit: "mm" | "cm" | "m" | null;
};

function normLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

export function matchInventoryByCsvLabel(
  label: string,
  items: InventoryItemRow[]
): InventoryItemRow | null {
  const n = normLabel(label);
  if (!n) return null;
  let best: InventoryItemRow | null = null;
  let score = 0;
  for (const it of items) {
    if (it.isDeleted === true) continue;
    const name = normLabel(String(it.name || ""));
    if (!name) continue;
    if (name === n) return it;
    if (name.includes(n) || n.includes(name)) {
      const sc = Math.min(name.length, n.length);
      if (sc > score) {
        score = sc;
        best = it;
      }
    }
  }
  return best;
}

export function parseCsvMaterialText(text: string): { name: string; qty: number; unit?: string }[] {
  const stripped = text.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<string[]>(stripped, { skipEmptyLines: "greedy" });
  const rows = (parsed.data || []).filter((r) => r.some((c) => String(c || "").trim()));
  if (rows.length === 0) return [];
  const first = rows[0].map((c) => String(c || "").trim());
  const looksHeader =
    /název|položka|name|item|material|description|sku/i.test(first[0] || "") &&
    /množství|mnozstvi|qty|quantity|amount|počet|kus/i.test(first[1] || "");
  const start = looksHeader ? 1 : 0;
  const out: { name: string; qty: number; unit?: string }[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[0] ?? "").trim();
    const qtyCell = String(r[1] ?? "").trim().replace(/\s/g, "").replace(",", ".");
    const qty = Number(qtyCell);
    const unit = r[2] != null ? String(r[2]).trim() : undefined;
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, qty, unit: unit || undefined });
  }
  return out;
}

function defaultLengthInputUnit(item: InventoryItemRow | null): "mm" | "cm" | "m" {
  if (!item) return "mm";
  const u = String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
  if (u === "cm" || u === "m" || u === "mm") return u;
  return "mm";
}

function availableQtyForItem(i: InventoryItemRow): number {
  const mode = String(i.stockTrackingMode || "pieces");
  if (mode === "length") {
    const cur = i.currentLength;
    if (cur != null && Number.isFinite(Number(cur))) return Number(cur);
  }
  return Number(i.quantity ?? 0);
}

function qtyInStockUnits(
  item: InventoryItemRow,
  qtyInput: number,
  inputLengthUnit: "mm" | "cm" | "m" | null
): number | null {
  const mode = String(item.stockTrackingMode || "pieces");
  if (mode !== "length" || !inputLengthUnit) return qtyInput;
  const mm = lengthToMillimeters(qtyInput, inputLengthUnit);
  if (mm == null) return null;
  const stockU = String(item.lengthStockUnit || item.unit || "mm")
    .trim()
    .toLowerCase();
  return millimetersToUnit(mm, stockU);
}

function lineIssueStatus(
  line: CsvDraftLine,
  inv: InventoryItemRow | undefined
): "ok" | "shortage" | "not_found" {
  if (!line.inventoryItemId) return "not_found";
  if (!inv) return "not_found";
  const av = availableQtyForItem(inv);
  const need = qtyInStockUnits(inv, line.quantity, line.inputLengthUnit);
  if (need == null || !Number.isFinite(need)) return "shortage";
  if (need > av + 1e-9) return "shortage";
  return "ok";
}

function newLineId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `L_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function CsvMaterialProposalDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: CsvMaterialDialogSource | null;
  inventoryItems: InventoryItemRow[];
  onIssued: () => void;
}) {
  const { open, onOpenChange, source, inventoryItems, onIssued } = props;
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"draft" | "confirmed" | null>(null);
  const [lines, setLines] = useState<CsvDraftLine[]>([]);
  const [batchNote, setBatchNote] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invById = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    for (const i of inventoryItems) m.set(i.id, i);
    return m;
  }, [inventoryItems]);

  const issueableItems = useMemo(
    () =>
      inventoryItems.filter((i) => {
        if (i.isDeleted === true) return false;
        if (i.remainderFullyConsumed === true) return false;
        if (i.isRemainder === true && i.remainderAvailable === false) return false;
        return true;
      }),
    [inventoryItems]
  );

  const loadDraft = useCallback(async () => {
    if (!user || !source) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const q = new URLSearchParams({
        jobId: source.jobId,
        folderId: source.folderId,
        jobFolderImageId: source.jobFolderImageId,
      });
      const res = await fetch(`/api/company/production/csv-material-draft?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Draft nelze načíst.");
      }
      const d = j.draft as
        | {
            status?: string;
            lines?: CsvDraftLine[];
          }
        | null
        | undefined;
      if (d && Array.isArray(d.lines) && d.lines.length > 0) {
        setDraftStatus(d.status === "confirmed" ? "confirmed" : "draft");
        setLines(
          d.lines.map((row) => ({
            id: String(row.id || newLineId()),
            csvLabel: String(row.csvLabel || ""),
            inventoryItemId:
              typeof row.inventoryItemId === "string" && row.inventoryItemId.trim()
                ? row.inventoryItemId.trim()
                : null,
            quantity: Number(row.quantity) || 0,
            inputLengthUnit:
              row.inputLengthUnit === "mm" || row.inputLengthUnit === "cm" || row.inputLengthUnit === "m"
                ? row.inputLengthUnit
                : null,
          }))
        );
      } else {
        setDraftStatus(null);
        setLines([]);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Chyba",
        description: e instanceof Error ? e.message : "Načtení se nezdařilo.",
      });
    } finally {
      setLoading(false);
    }
  }, [user, source, toast]);

  useEffect(() => {
    if (!open || !source) return;
    void loadDraft();
  }, [open, source?.jobId, source?.folderId, source?.jobFolderImageId, loadDraft]);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (!user || !source || draftStatus === "confirmed") return true;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/production/csv-material-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId: source.jobId,
          folderId: source.folderId,
          jobFolderImageId: source.jobFolderImageId,
          csvFileUrl: source.fileUrl,
          csvFileName: source.fileName,
          lines,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Uložení draftu se nezdařilo.");
      }
      return true;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Uložení",
        description: e instanceof Error ? e.message : "Draft se nepodařilo uložit.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [user, source, lines, draftStatus, toast]);

  useEffect(() => {
    if (!open || !source || draftStatus === "confirmed") return;
    if (lines.length === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistDraft();
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [lines, open, source, draftStatus, persistDraft]);

  const generateFromCsv = async () => {
    if (!source) return;
    setLoading(true);
    try {
      const res = await fetch(source.fileUrl);
      if (!res.ok) throw new Error("Soubor CSV se nepodařilo stáhnout (zkuste znovu nebo ověřte oprávnění).");
      const text = await res.text();
      const parsed = parseCsvMaterialText(text);
      if (parsed.length === 0) {
        throw new Error("V CSV nebyly nalezeny platné řádky (očekává se název a množství).");
      }
      const next: CsvDraftLine[] = parsed.map((p) => {
        const match = matchInventoryByCsvLabel(p.name, inventoryItems);
        const inv = match;
        const isLen = inv && String(inv.stockTrackingMode) === "length";
        return {
          id: newLineId(),
          csvLabel: p.name,
          inventoryItemId: match?.id ?? null,
          quantity: p.qty,
          inputLengthUnit: isLen ? defaultLengthInputUnit(inv) : null,
        };
      });
      setLines(next);
      setDraftStatus("draft");
      toast({ title: "Návrh vytvořen", description: "Zkontrolujte párování se skladem a uložte potvrzením." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "CSV",
        description: e instanceof Error ? e.message : "Zpracování selhalo.",
      });
    } finally {
      setLoading(false);
    }
  };

  const updateLine = (id: string, patch: Partial<CsvDraftLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  const addManualLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: newLineId(),
        csvLabel: "Ruční položka",
        inventoryItemId: null,
        quantity: 1,
        inputLengthUnit: null,
      },
    ]);
  };

  const allOk = useMemo(() => {
    if (lines.length === 0) return false;
    return lines.every((l) => {
      const inv = l.inventoryItemId ? invById.get(l.inventoryItemId) : undefined;
      return lineIssueStatus(l, inv) === "ok";
    });
  }, [lines, invById]);

  const confirmIssue = async () => {
    if (!user || !source || draftStatus === "confirmed") return;
    if (!allOk) {
      toast({
        variant: "destructive",
        title: "Nelze potvrdit",
        description: "Vyřešte řádky „nenalezeno“ nebo „nedostatek“.",
      });
      return;
    }
    setConfirming(true);
    try {
      const token = await user.getIdToken();
      const saved = await persistDraft();
      if (!saved) return;
      const res = await fetch("/api/company/production/csv-material-confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId: source.jobId,
          folderId: source.folderId,
          jobFolderImageId: source.jobFolderImageId,
          note: batchNote.trim() || null,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof j?.error === "string" ? j.error : "Potvrzení se nezdařilo.");
      }
      toast({
        title: "Materiál vydán",
        description: `Potvrzeno ${typeof j?.issued === "number" ? j.issued : lines.length} položek ze skladu.`,
      });
      setDraftStatus("confirmed");
      onIssued();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Výdej",
        description: e instanceof Error ? e.message : "Potvrzení se nezdařilo.",
      });
    } finally {
      setConfirming(false);
    }
  };

  if (!source) return null;

  const draftKey = csvMaterialDraftDocId(source.folderId, source.jobFolderImageId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(92vh,900px)] overflow-y-auto bg-white border-slate-200 text-slate-900 sm:max-w-3xl"
        data-portal-dialog
      >
        <DialogHeader>
          <DialogTitle>Návrh materiálu ze CSV</DialogTitle>
          <p className="text-sm text-slate-600 font-normal">
            {source.fileName}{" "}
            <span className="text-xs text-slate-400">({draftKey})</span>
          </p>
        </DialogHeader>

        <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
          Materiál bude odečten ze skladu až po kliknutí na „Potvrdit výdej materiálu“. Do té doby jde návrh upravit;
          změny se ukládají jako draft (obnoví se po opětovném otevření).
        </div>

        {draftStatus === "confirmed" ? (
          <p className="text-sm text-emerald-800">
            Tento CSV soubor byl již potvrzen — sklad byl aktualizován. Pro nový návrh nahrajte nový CSV soubor k
            zakázce.
          </p>
        ) : null}

        {loading && lines.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : null}

        {draftStatus !== "confirmed" && lines.length === 0 && !loading ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Zatím žádný uložený návrh. Načtěte obsah CSV a vygenerujte řádky — sklad se zatím nemění.
            </p>
            <Button type="button" onClick={() => void generateFromCsv()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Načíst CSV a vytvořit návrh
            </Button>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-slate-800">Návrh (nepotvrzeno) — upravte dle skutečnosti</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-300"
                  disabled={loading || draftStatus === "confirmed"}
                  onClick={() => void generateFromCsv()}
                >
                  Znovu z CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-slate-300"
                  disabled={draftStatus === "confirmed"}
                  onClick={addManualLine}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Přidat řádek
                </Button>
                {saving ? (
                  <span className="text-xs text-slate-500 self-center flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Ukládám draft…
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="min-w-[140px]">Text z CSV</TableHead>
                    <TableHead className="min-w-[200px]">Skladová položka</TableHead>
                    <TableHead className="w-[110px]">Množství</TableHead>
                    <TableHead className="w-[100px] hidden sm:table-cell">Jedn. délky</TableHead>
                    <TableHead className="w-[100px]">Skladem</TableHead>
                    <TableHead className="w-[110px]">Stav</TableHead>
                    <TableHead className="w-[52px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const inv = line.inventoryItemId ? invById.get(line.inventoryItemId) : undefined;
                    const st = lineIssueStatus(line, inv);
                    const av = inv ? availableQtyForItem(inv) : null;
                    const isLen = inv && String(inv.stockTrackingMode) === "length";
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="align-top">
                          <Input
                            className="bg-white min-w-[120px]"
                            value={line.csvLabel}
                            disabled={draftStatus === "confirmed"}
                            onChange={(e) => updateLine(line.id, { csvLabel: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="align-top min-w-[200px]">
                          <Select
                            value={line.inventoryItemId || "__none__"}
                            disabled={draftStatus === "confirmed"}
                            onValueChange={(v) => {
                              const id = v === "__none__" ? null : v;
                              const nextInv = id ? invById.get(id) : undefined;
                              const il =
                                nextInv && String(nextInv.stockTrackingMode) === "length"
                                  ? defaultLengthInputUnit(nextInv)
                                  : null;
                              updateLine(line.id, { inventoryItemId: id, inputLengthUnit: il });
                            }}
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Vyberte…" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— nenalezeno —</SelectItem>
                              {issueableItems.map((it) => (
                                <SelectItem key={it.id} value={it.id}>
                                  {`${it.name} (${it.id})`.slice(0, 140)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            className="bg-white w-[100px]"
                            inputMode="decimal"
                            disabled={draftStatus === "confirmed"}
                            value={String(line.quantity)}
                            onChange={(e) => {
                              const q = Number(String(e.target.value).replace(",", "."));
                              updateLine(line.id, {
                                quantity: Number.isFinite(q) && q > 0 ? q : line.quantity,
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell className="align-top hidden sm:table-cell">
                          {isLen ? (
                            <Select
                              value={line.inputLengthUnit || "mm"}
                              disabled={draftStatus === "confirmed"}
                              onValueChange={(v) =>
                                updateLine(line.id, {
                                  inputLengthUnit: v === "mm" || v === "cm" || v === "m" ? v : null,
                                })
                              }
                            >
                              <SelectTrigger className="bg-white w-[92px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="mm">mm</SelectItem>
                                <SelectItem value="cm">cm</SelectItem>
                                <SelectItem value="m">m</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-sm tabular-nums">
                          {av != null ? av : "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          {st === "ok" ? (
                            <span className="text-emerald-700 text-sm font-medium">OK</span>
                          ) : st === "shortage" ? (
                            <span className="text-red-700 text-sm font-medium">Nedostatek</span>
                          ) : (
                            <span className="text-amber-800 text-sm font-medium">Nenalezeno</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-slate-500"
                            disabled={draftStatus === "confirmed"}
                            onClick={() => removeLine(line.id)}
                            aria-label="Smazat řádek"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1">
              <Label className="text-slate-800">Poznámka ke všem řádkům (volitelné)</Label>
              <Input
                className="bg-white"
                value={batchNote}
                disabled={draftStatus === "confirmed"}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder="např. výdej dle výkresu…"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-end">
          <Button type="button" variant="outline" className="border-slate-300" onClick={() => onOpenChange(false)}>
            Zavřít
          </Button>
          {draftStatus !== "confirmed" && lines.length > 0 ? (
            <Button type="button" disabled={!allOk || confirming} onClick={() => void confirmIssue()}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Potvrdit výdej materiálu
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
