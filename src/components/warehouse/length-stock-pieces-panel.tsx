"use client";

import React, { useCallback, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  limit,
  type Firestore,
} from "firebase/firestore";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { InventoryItemRow, StockPieceRow } from "@/lib/inventory-types";
import {
  countPiecesExact,
  formatMmCs,
  isInventoryPiecesLengthRow,
  partialRemainderLengthsMm,
  pieceUiKind,
  sortStockPiecesForDisplay,
} from "@/lib/stock-pieces-display";

type Props = {
  firestore: Firestore;
  companyId: string;
  row: InventoryItemRow;
  /** Úzký sloupec v tabulce vs. karta na mobilu */
  variant?: "compact" | "card";
};

export function LengthStockPiecesPanel({
  firestore,
  companyId,
  row,
  variant = "compact",
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pieces, setPieces] = useState<StockPieceRow[] | null>(null);
  const [lastCutByPieceId, setLastCutByPieceId] = useState<Record<string, string>>(
    {}
  );
  const [showConsumed, setShowConsumed] = useState(false);

  const loadPieces = useCallback(async () => {
    if (!firestore) return;
    setLoading(true);
    try {
      const col = collection(
        firestore,
        "companies",
        companyId,
        "inventoryItems",
        row.id,
        "stockPieces"
      );
      const snap = await getDocs(col);
      const list: StockPieceRow[] = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          materialId: String(x.materialId ?? row.id),
          originalLength: Number(x.originalLength ?? 0),
          remainingLength: Number(x.remainingLength ?? 0),
          status: String(x.status || "available") as StockPieceRow["status"],
          createdAt: x.createdAt,
        };
      });

      const lastMap: Record<string, string> = {};
      try {
        const cutsQ = query(
          collection(firestore, "companies", companyId, "stockCuts"),
          where("materialId", "==", row.id),
          limit(2000)
        );
        const cutsSnap = await getDocs(cutsQ);
        for (const docSnap of cutsSnap.docs) {
          const c = docSnap.data() as Record<string, unknown>;
          const pid = String(c.pieceId ?? "");
          const dt = String(c.date ?? "");
          if (!pid || !dt) continue;
          const prev = lastMap[pid];
          if (!prev || dt > prev) lastMap[pid] = dt;
        }
      } catch {
        /* index / prázdné řezy */
      }

      setPieces(list);
      setLastCutByPieceId(lastMap);
    } finally {
      setLoading(false);
    }
  }, [firestore, companyId, row.id]);

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      setPieces(null);
      setLastCutByPieceId({});
      return;
    }
    setOpen(true);
    void loadPieces();
  };

  const stats = row.stockPieceStats;
  const nom = row.pieceLengthMm != null ? Number(row.pieceLengthMm) : null;
  const qtyMm = Number(row.quantity ?? 0);
  const exact = pieces ? countPiecesExact(pieces) : null;
  const fullC = exact?.full ?? stats?.full ?? 0;
  const partC = exact?.partial ?? stats?.partial ?? 0;
  const consC = exact?.consumed ?? stats?.empty ?? 0;

  const partialLens =
    open && pieces && pieces.length ? partialRemainderLengthsMm(pieces) : [];

  let singlePartialMm: number | null = null;
  if (pieces && partC === 1 && partialLens.length === 1) {
    singlePartialMm = partialLens[0] ?? null;
  } else if (!pieces && partC === 1 && nom != null && Number.isFinite(qtyMm)) {
    singlePartialMm = Math.max(0, qtyMm - fullC * nom);
  }

  const summaryClass =
    variant === "card"
      ? "text-sm text-slate-700 space-y-1"
      : "text-xs text-slate-600 space-y-0.5 text-left sm:text-right";

  const sorted =
    pieces && pieces.length ? sortStockPiecesForDisplay(pieces) : [];

  const visiblePieces = showConsumed
    ? sorted
    : sorted.filter((p) => pieceUiKind(
        Number(p.remainingLength),
        Number(p.originalLength),
        String(p.status || "")
      ) !== "spotřebovaný");

  return (
    <div className={cn("space-y-1.5", variant === "card" && "rounded-lg border border-slate-200 bg-slate-50/80 p-3")}>
      <div className={summaryClass}>
        {nom != null && nom > 0 ? (
          <p className="font-medium text-slate-900">
            Plné kusy: {fullC} ks × {formatMmCs(nom)} mm
          </p>
        ) : (
          <p className="font-medium text-slate-900">Plné kusy: {fullC} ks</p>
        )}
        <p>Načaté kusy: {partC} ks</p>
        <p>Spotřebované kusy: {consC} ks</p>
        {partC === 1 && singlePartialMm != null ? (
          <p className="font-medium text-slate-800">
            Zbytek: {formatMmCs(singlePartialMm)} mm
          </p>
        ) : null}
        {partC > 1 && !open ? (
          <p className="font-medium text-slate-800">
            Zbytky: {partC} ks — rozbalte pro jednotlivé délky.
          </p>
        ) : null}
        {partC > 1 && open && partialLens.length > 0 ? (
          <div className="rounded-md border border-slate-200 bg-white/80 px-2 py-1.5">
            <p className="font-medium text-slate-800">Délky načatých (mm)</p>
            <ul className="mt-1 list-inside list-disc text-slate-700">
              {partialLens.map((mm, i) => (
                <li key={i}>{formatMmCs(mm)} mm</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-slate-800">
          Celkem dostupné: <strong>{formatMmCs(qtyMm)}</strong> mm
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-8 gap-1 border-slate-300 bg-white text-xs text-slate-800",
          variant === "card" && "w-full justify-between"
        )}
        onClick={handleToggle}
        disabled={loading}
      >
        {loading ? (
          "Načítám…"
        ) : open ? (
          <>
            Sbalit kusy
            <ChevronDown className="h-4 w-4 rotate-180 transition-transform" />
          </>
        ) : (
          <>
            Rozbalit kusy
            <ChevronDown className="h-4 w-4 transition-transform" />
          </>
        )}
      </Button>

      {open && pieces && (
        <div className="space-y-2 pt-1">
          {consC > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={showConsumed}
                onChange={(e) => setShowConsumed(e.target.checked)}
              />
              Zobrazit spotřebované kusy
            </label>
          ) : null}

          <div className="hidden md:block overflow-x-auto rounded-md border border-slate-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-slate-700">#</TableHead>
                  <TableHead className="text-slate-700">Původ (mm)</TableHead>
                  <TableHead className="text-slate-700">Zbývá (mm)</TableHead>
                  <TableHead className="text-slate-700">Stav</TableHead>
                  <TableHead className="text-slate-700">Poslední řez</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePieces.map((p, idx) => {
                  const ui = pieceUiKind(
                    Number(p.remainingLength),
                    Number(p.originalLength),
                    String(p.status || "")
                  );
                  return (
                    <TableRow key={p.id} className="border-slate-100">
                      <TableCell className="tabular-nums text-slate-800">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatMmCs(Number(p.originalLength))}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium">
                        {formatMmCs(Number(p.remainingLength))}
                      </TableCell>
                      <TableCell className="capitalize text-slate-700">{ui}</TableCell>
                      <TableCell className="text-slate-600">
                        {lastCutByPieceId[p.id] ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 md:hidden">
            {visiblePieces.map((p, idx) => {
              const ui = pieceUiKind(
                Number(p.remainingLength),
                Number(p.originalLength),
                String(p.status || "")
              );
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm"
                >
                  <p className="font-semibold text-slate-900">
                    Kus #{idx + 1}
                  </p>
                  <p className="mt-1 text-slate-700">
                    Původní délka: {formatMmCs(Number(p.originalLength))} mm
                  </p>
                  <p className="text-slate-700">
                    Zbývá: {formatMmCs(Number(p.remainingLength))} mm
                  </p>
                  <p className="text-slate-700">
                    Stav: <span className="capitalize">{ui}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Poslední řez: {lastCutByPieceId[p.id] ?? "—"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function LengthStockPiecesPanelGate(props: {
  firestore: Firestore | null;
  companyId: string | null | undefined;
  row: InventoryItemRow;
  variant?: "compact" | "card";
}): React.ReactNode {
  if (!props.firestore || !props.companyId) return null;
  if (!isInventoryPiecesLengthRow(props.row)) return null;
  return (
    <LengthStockPiecesPanel
      firestore={props.firestore}
      companyId={props.companyId}
      row={props.row}
      variant={props.variant}
    />
  );
}
