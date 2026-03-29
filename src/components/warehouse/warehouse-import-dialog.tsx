"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { FileUp, Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventoryItemRow } from "@/lib/inventory-types";
import {
  extractTextFromPdfBuffer,
  parseWarehouseImportCsv,
  parseWarehouseImportPdfText,
  validateImportRow,
  type WarehouseImportDraftRow,
} from "@/lib/warehouse-import";

export type WarehouseImportDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firestore: Firestore;
  companyId: string;
  userId: string;
  items: InventoryItemRow[];
};

type DuplicateMatch = { id: string; name: string; quantity: number; unit: string };

type EnrichedDraft = WarehouseImportDraftRow & {
  duplicateMatches: DuplicateMatch[];
  mergeTargetId: string | null;
  action: "merge" | "new";
};

function matchDuplicates(
  name: string,
  items: InventoryItemRow[]
): { id: string; name: string; quantity: number; unit: string }[] {
  const n = name.trim().toLowerCase();
  if (!n) return [];
  return items
    .filter((i) => i.name.trim().toLowerCase() === n)
    .map((i) => ({
      id: i.id,
      name: i.name,
      quantity: Number(i.quantity ?? 0),
      unit: i.unit || "ks",
    }));
}

function enrichDrafts(
  rows: WarehouseImportDraftRow[],
  items: InventoryItemRow[]
): EnrichedDraft[] {
  return rows.map((r) => {
    const duplicateMatches = matchDuplicates(r.name, items);
    const action: "merge" | "new" =
      duplicateMatches.length > 0 ? "merge" : "new";
    return {
      ...r,
      duplicateMatches,
      mergeTargetId: duplicateMatches[0]?.id ?? null,
      action,
    };
  });
}

function applyDuplicateMeta(
  d: EnrichedDraft,
  items: InventoryItemRow[]
): EnrichedDraft {
  const duplicateMatches = matchDuplicates(d.name, items);
  let action = d.action;
  let mergeTargetId = d.mergeTargetId;
  if (duplicateMatches.length === 0) {
    action = "new";
    mergeTargetId = null;
  } else {
    if (!mergeTargetId || !duplicateMatches.some((m) => m.id === mergeTargetId)) {
      mergeTargetId = duplicateMatches[0]?.id ?? null;
    }
    if (action !== "merge" && action !== "new") action = "merge";
  }
  return { ...d, duplicateMatches, mergeTargetId, action };
}

function emptyDraft(): WarehouseImportDraftRow {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `r-${Date.now()}`;
  return {
    localId: id,
    name: "",
    sku: "",
    quantity: 1,
    unit: "ks",
    unitPrice: 0,
    vatRate: null,
    supplier: "",
  };
}

export function WarehouseImportDialog({
  open,
  onOpenChange,
  firestore,
  companyId,
  userId,
  items,
}: WarehouseImportDialogProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceKind, setSourceKind] = useState<"csv" | "pdf" | null>(null);
  const [drafts, setDrafts] = useState<EnrichedDraft[]>([]);
  const [step, setStep] = useState<"pick" | "preview">("pick");

  const reset = useCallback(() => {
    setParsing(false);
    setSaving(false);
    setSourceKind(null);
    setDrafts([]);
    setStep("pick");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const applyParsed = useCallback(
    (rows: WarehouseImportDraftRow[], kind: "csv" | "pdf") => {
      if (process.env.NODE_ENV === "development") {
        if (kind === "csv") console.log("parsed CSV", rows);
        else console.log("parsed PDF", rows);
      }
      if (rows.length === 0) {
        toast({
          variant: "destructive",
          title: "Soubor se nepodařilo zpracovat",
          description: "Nepodařilo se najít žádné položky. Zkontrolujte formát souboru.",
        });
        return;
      }
      setSourceKind(kind);
      setDrafts(enrichDrafts(rows, items));
      setStep("preview");
    },
    [items, toast]
  );

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    setParsing(true);
    try {
      if (name.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        const rows = parseWarehouseImportCsv(text);
        applyParsed(rows, "csv");
      } else if (name.endsWith(".pdf") || file.type === "application/pdf") {
        const buf = await file.arrayBuffer();
        const text = await extractTextFromPdfBuffer(buf);
        const rows = parseWarehouseImportPdfText(text);
        applyParsed(rows, "pdf");
      } else {
        toast({
          variant: "destructive",
          title: "Nepodporovaný soubor",
          description: "Nahrajte soubor CSV nebo PDF.",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Soubor se nepodařilo zpracovat",
        description: "Zkuste jiný soubor nebo export znovu uložit.",
      });
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const updateDraft = (localId: string, patch: Partial<EnrichedDraft>) => {
    setDrafts((prev) =>
      prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d))
    );
  };

  const removeDraft = (localId: string) => {
    setDrafts((prev) => prev.filter((d) => d.localId !== localId));
  };

  const addBlankRow = () => {
    setDrafts((prev) => [...prev, ...enrichDrafts([emptyDraft()], items)]);
  };

  const itemsById = useMemo(() => {
    const m = new Map<string, InventoryItemRow>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  useEffect(() => {
    if (!open || step !== "preview") return;
    setDrafts((prev) => prev.map((d) => applyDuplicateMeta(d, items)));
  }, [items, open, step]);

  const submit = async () => {
    if (!sourceKind) return;
    for (const d of drafts) {
      const err = validateImportRow(d);
      if (err) {
        toast({ variant: "destructive", title: "Kontrola řádků", description: err });
        return;
      }
      if (d.duplicateMatches.length > 0 && d.action === "merge") {
        if (!d.mergeTargetId || !itemsById.has(d.mergeTargetId)) {
          toast({
            variant: "destructive",
            title: "Duplicita",
            description: `Vyberte existující položku pro řádek „${d.name.trim() || "—"}“.`,
          });
          return;
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const batchNote = `Hromadný import (${sourceKind.toUpperCase()})`;

    setSaving(true);
    try {
      for (const d of drafts) {
        await runTransaction(firestore, async (tx) => {
          if (d.duplicateMatches.length > 0 && d.action === "merge" && d.mergeTargetId) {
            const itemRef = doc(
              firestore,
              "companies",
              companyId,
              "inventoryItems",
              d.mergeTargetId
            );
            const snap = await tx.get(itemRef);
            if (!snap.exists()) throw new Error(`Položka ${d.mergeTargetId} neexistuje.`);
            const cur = snap.data() as InventoryItemRow;
            const prev = Number(cur.quantity ?? 0);
            tx.update(itemRef, {
              quantity: prev + d.quantity,
              updatedAt: serverTimestamp(),
              ...(d.unitPrice > 0 && (cur.unitPrice == null || cur.unitPrice === 0)
                ? { unitPrice: d.unitPrice }
                : {}),
              ...(d.vatRate != null ? { vatRate: d.vatRate } : {}),
              ...(d.supplier.trim() ? { supplier: d.supplier.trim() } : {}),
            });
            const movRef = doc(
              collection(firestore, "companies", companyId, "inventoryMovements")
            );
            tx.set(movRef, {
              companyId,
              type: "in",
              itemId: d.mergeTargetId,
              itemName: cur.name,
              quantity: d.quantity,
              unit: d.unit.trim() || cur.unit || "ks",
              date: today,
              note: batchNote,
              supplier: d.supplier.trim() || null,
              documentNo: null,
              createdAt: serverTimestamp(),
              createdBy: userId,
            });
            return;
          }

          const itemRef = doc(collection(firestore, "companies", companyId, "inventoryItems"));
          const itemId = itemRef.id;
          tx.set(itemRef, {
            companyId,
            name: d.name.trim(),
            sku: d.sku.trim() || null,
            unit: d.unit.trim() || "ks",
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            vatRate: d.vatRate,
            supplier: d.supplier.trim() || null,
            note: null,
            source: sourceKind === "csv" ? "csv-import" : "pdf-import",
            createdAt: serverTimestamp(),
            createdBy: userId,
            updatedAt: serverTimestamp(),
          });
          const movRef = doc(
            collection(firestore, "companies", companyId, "inventoryMovements")
          );
          tx.set(movRef, {
            companyId,
            type: "in",
            itemId,
            itemName: d.name.trim(),
            quantity: d.quantity,
            unit: d.unit.trim() || "ks",
            date: today,
            note: batchNote,
            supplier: d.supplier.trim() || null,
            documentNo: null,
            createdAt: serverTimestamp(),
            createdBy: userId,
          });
        });
      }

      toast({
        title: "Položky byly úspěšně naskladněny",
        description: `Zpracováno ${drafts.length} řádků.`,
      });
      handleClose(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import se nezdařil",
        description: e instanceof Error ? e.message : "Zkuste to znovu.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="bg-white border-slate-200 text-slate-900 max-w-4xl max-h-[90vh] flex flex-col"
        data-portal-dialog
      >
        <DialogHeader>
          <DialogTitle>Import PDF / CSV</DialogTitle>
        </DialogHeader>

        {step === "pick" ? (
          <div className="space-y-4 py-4">
            <p className="text-sm text-slate-600">
              Nahrajte CSV nebo PDF. Zobrazí se náhled — nic se neuloží, dokud nepotvrdíte
              „Naskladnit“.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.pdf,text/csv,application/pdf"
              className="hidden"
              onChange={(ev) => void onFile(ev)}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2 w-full sm:w-auto"
              disabled={parsing}
              onClick={() => inputRef.current?.click()}
            >
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              Vybrat soubor
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 min-h-0 flex-1 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-600">
                Zdroj: {sourceKind === "csv" ? "CSV" : "PDF"} — upravte řádky a vyřešte případné
                duplicity.
              </p>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={addBlankRow}>
                <Plus className="h-4 w-4" /> Přidat řádek
              </Button>
            </div>
            <div className="border rounded-md overflow-auto max-h-[50vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">Název</TableHead>
                    <TableHead className="w-24">MJ</TableHead>
                    <TableHead className="w-24 text-right">Množství</TableHead>
                    <TableHead className="w-28 text-right">Cena</TableHead>
                    <TableHead className="w-20 text-right">DPH %</TableHead>
                    <TableHead className="min-w-[100px]">Dodavatel</TableHead>
                    <TableHead className="min-w-[180px]">Duplicita</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drafts.map((d) => (
                    <TableRow key={d.localId}>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm"
                          value={d.name}
                          onChange={(e) => updateDraft(d.localId, { name: e.target.value })}
                        />
                        <Input
                          className="h-7 text-xs mt-1"
                          placeholder="Kód / SKU"
                          value={d.sku}
                          onChange={(e) => updateDraft(d.localId, { sku: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm"
                          value={d.unit}
                          onChange={(e) => updateDraft(d.localId, { unit: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm text-right"
                          value={String(d.quantity)}
                          onChange={(e) => {
                            const n = Number(String(e.target.value).replace(",", "."));
                            updateDraft(d.localId, {
                              quantity: Number.isFinite(n) && n >= 0 ? n : 0,
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm text-right"
                          value={String(d.unitPrice)}
                          onChange={(e) => {
                            const n = Number(String(e.target.value).replace(",", "."));
                            updateDraft(d.localId, {
                              unitPrice: Number.isFinite(n) && n >= 0 ? n : 0,
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm text-right"
                          placeholder="—"
                          value={d.vatRate != null ? String(d.vatRate) : ""}
                          onChange={(e) => {
                            const t = e.target.value.trim();
                            if (t === "") {
                              updateDraft(d.localId, { vatRate: null });
                              return;
                            }
                            const n = Number(t.replace(",", "."));
                            updateDraft(d.localId, {
                              vatRate: Number.isFinite(n) && n >= 0 ? n : null,
                            });
                          }}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2">
                        <Input
                          className="h-8 text-sm"
                          value={d.supplier}
                          onChange={(e) => updateDraft(d.localId, { supplier: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="align-top p-2 text-xs">
                        {d.duplicateMatches.length === 0 ? (
                          <span className="text-slate-500">—</span>
                        ) : (
                          <div className="space-y-2">
                            <RadioGroup
                              value={d.action}
                              onValueChange={(v) =>
                                updateDraft(d.localId, {
                                  action: v === "merge" ? "merge" : "new",
                                })
                              }
                              className="gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <RadioGroupItem value="merge" id={`m-${d.localId}`} />
                                <Label htmlFor={`m-${d.localId}`} className="font-normal text-xs">
                                  Zvýšit množství
                                </Label>
                              </div>
                              <div className="flex items-center gap-2">
                                <RadioGroupItem value="new" id={`n-${d.localId}`} />
                                <Label htmlFor={`n-${d.localId}`} className="font-normal text-xs">
                                  Nová položka
                                </Label>
                              </div>
                            </RadioGroup>
                            {d.action === "merge" ? (
                              <Select
                                value={d.mergeTargetId ?? ""}
                                onValueChange={(v) => updateDraft(d.localId, { mergeTargetId: v })}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Vyberte položku" />
                                </SelectTrigger>
                                <SelectContent>
                                  {d.duplicateMatches.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                      {m.name} ({m.quantity} {m.unit})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top p-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => removeDraft(d.localId)}
                          aria-label="Smazat řádek"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "preview" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setStep("pick");
              }}
            >
              Znovu nahrát
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            Zrušit
          </Button>
          {step === "preview" ? (
            <Button type="button" disabled={saving || drafts.length === 0} onClick={() => void submit()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Naskladnit"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
