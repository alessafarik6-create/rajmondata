"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { parseLeadImportPayload, type LeadImportRow } from "@/lib/lead-import-parse";

export type LeadRequestsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL z nastavení organizace (trimnutá nebo prázdná). */
  importUrl: string | undefined;
};

export function LeadRequestsDialog({
  open,
  onOpenChange,
  importUrl,
}: LeadRequestsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadImportRow[]>([]);

  const trimmed = (importUrl ?? "").trim();

  useEffect(() => {
    if (!open) {
      setError(null);
      setRows([]);
      setLoading(false);
      return;
    }

    if (!trimmed) {
      setError(null);
      setRows([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);

    void (async () => {
      try {
        const res = await fetch(trimmed, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        let json: unknown;
        try {
          json = JSON.parse(text) as unknown;
        } catch {
          throw new Error("Odpověď není platný JSON.");
        }
        const parsed = parseLeadImportPayload(json);
        if (!cancelled) {
          setRows(parsed);
        }
      } catch (e) {
        console.error("[LeadRequestsDialog] fetch failed", e);
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "Nepodařilo se načíst poptávky (síť nebo CORS)."
          );
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, trimmed]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-white border-slate-200 text-slate-900 max-w-5xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col"
        data-portal-dialog
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Poptávky</DialogTitle>
          <DialogDescription>
            Data se načítají z URL nastavené v Nastavení organizace (Import poptávek).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {!trimmed ? (
            <Alert>
              <AlertTitle>Není nastaven URL pro import poptávek</AlertTitle>
              <AlertDescription>
                V sekci <strong>Nastavení → Organizace</strong> vyplňte pole „Import poptávek (URL)“ a uložte.
              </AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="flex items-center gap-2 py-8 text-slate-700">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span>Načítám poptávky…</span>
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>Nepodařilo se načíst poptávky</AlertTitle>
              <AlertDescription className="break-words">{error}</AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-600 py-4">Žádné záznamy k zobrazení.</p>
          ) : (
            <div className="rounded-md border border-slate-200 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="min-w-[120px]">Jméno</TableHead>
                    <TableHead className="min-w-[110px]">Telefon</TableHead>
                    <TableHead className="min-w-[160px]">E-mail</TableHead>
                    <TableHead className="min-w-[180px]">Adresa</TableHead>
                    <TableHead className="min-w-[200px]">Zpráva</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="align-top text-sm">{r.jmeno || "—"}</TableCell>
                      <TableCell className="align-top text-sm tabular-nums">
                        {r.telefon || "—"}
                      </TableCell>
                      <TableCell className="align-top text-sm break-all">
                        {r.email || "—"}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-pre-wrap">
                        {r.adresa || "—"}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-pre-wrap max-w-md">
                        {r.zprava || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
