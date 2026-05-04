"use client";

import { useEffect, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import {
  countPiecesExact,
  formatMmCs,
  partialRemainderLengthsMm,
} from "@/lib/stock-pieces-display";
import type { StockPieceRow } from "@/lib/inventory-types";

export type StockPiecesSummary = {
  full: number;
  partial: number;
  consumed: number;
  /** Krátký text pro buňku tabulky */
  label: string;
  /** Délky načatých zbytků (mm) */
  partialLengthsMm: number[];
  pieceLengthMm: number | null;
  /** Surová data kusů (export PDF / přesné součty) */
  pieces: StockPieceRow[];
  loading: boolean;
};

function summarizePieces(pieces: StockPieceRow[], pieceLengthMm: number | null): StockPiecesSummary {
  const c = countPiecesExact(pieces);
  const partialLengths = partialRemainderLengthsMm(pieces);
  const lenHint =
    pieceLengthMm != null && Number.isFinite(pieceLengthMm) && pieceLengthMm > 0
      ? `Délka kusu: ${formatMmCs(pieceLengthMm)} mm`
      : "";
  const parts: string[] = [];
  if (c.full > 0) parts.push(`plné ${c.full}`);
  if (c.partial > 0) parts.push(`načaté ${c.partial}`);
  if (partialLengths.length > 0) {
    const show = partialLengths.slice(0, 3).map((mm) => `${formatMmCs(mm)} mm`);
    parts.push(`zbytky: ${show.join(", ")}${partialLengths.length > 3 ? "…" : ""}`);
  }
  const label = [lenHint && lenHint, parts.join(" · ")].filter(Boolean).join(" · ") || "—";
  return {
    full: c.full,
    partial: c.partial,
    consumed: c.consumed,
    label,
    partialLengthsMm: partialLengths,
    pieceLengthMm,
    pieces,
    loading: false,
  };
}

/**
 * Načte stockPieces pro dané skladové položky a vrátí souhrn kusů (délkový materiál).
 * `itemMetasKey` musí být stabilní řetězec (např. JSON seřazených id), aby se zbytečně nenačítalo.
 */
export function useStockPiecesSummaries(
  firestore: Firestore | null,
  companyId: string | null,
  itemMetas: { id: string; pieceLengthMm?: number | null }[],
  itemMetasKey: string
): Record<string, StockPiecesSummary> {
  const [map, setMap] = useState<Record<string, StockPiecesSummary>>({});
  const metasRef = useRef(itemMetas);
  metasRef.current = itemMetas;

  useEffect(() => {
    const items = metasRef.current;
    if (!firestore || !companyId || items.length === 0) {
      setMap({});
      return;
    }

    let cancelled = false;

    (async () => {
      const out: Record<string, StockPiecesSummary> = {};
      await Promise.all(
        items.map(async (meta) => {
          try {
            const col = collection(
              firestore,
              "companies",
              companyId,
              "inventoryItems",
              meta.id,
              "stockPieces"
            );
            const snap = await getDocs(col);
            const pieces: StockPieceRow[] = snap.docs.map((d) => {
              const x = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                materialId: meta.id,
                remainingLength: Number(x.remainingLength),
                originalLength: Number(x.originalLength ?? x.remainingLength),
                status: String(x.status || "available"),
              } as StockPieceRow;
            });
            const pl =
              meta.pieceLengthMm != null && Number.isFinite(Number(meta.pieceLengthMm))
                ? Number(meta.pieceLengthMm)
                : null;
            out[meta.id] = summarizePieces(pieces, pl);
          } catch {
            out[meta.id] = {
              full: 0,
              partial: 0,
              consumed: 0,
              label: "—",
              partialLengthsMm: [],
              pieceLengthMm:
                meta.pieceLengthMm != null && Number.isFinite(Number(meta.pieceLengthMm))
                  ? Number(meta.pieceLengthMm)
                  : null,
              pieces: [],
              loading: false,
            };
          }
        })
      );
      if (!cancelled) setMap(out);
    })();

    return () => {
      cancelled = true;
    };
  }, [firestore, companyId, itemMetasKey]);

  return map;
}
