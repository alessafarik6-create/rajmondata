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
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { useUser } from "@/firebase";

export type LeadRequestsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID organizace — URL pro import se načte na serveru z nastavení. */
  companyId: string | undefined;
};

type ApiErrorBody = {
  ok?: false;
  error?: string;
  code?: string;
};

type ApiSuccessBody = {
  ok: true;
  rows: LeadImportRow[];
  warning?: string;
};

function messageForApiError(
  data: ApiErrorBody | null,
  httpStatus: number
): string {
  if (data?.error && typeof data.error === "string") return data.error;
  switch (httpStatus) {
    case 401:
      return "Chybí přihlášení nebo vypršel token. Obnovte stránku a zkuste znovu.";
    case 403:
      return "Nemáte přístup k načtení poptávek pro tuto organizaci.";
    case 400:
      return "Neplatný požadavek (zkontrolujte nastavení organizace).";
    case 503:
      return "Služba je dočasně nedostupná.";
    default:
      return `Nepodařilo se načíst poptávky (HTTP ${httpStatus}).`;
  }
}

export function LeadRequestsDialog({
  open,
  onOpenChange,
  companyId,
}: LeadRequestsDialogProps) {
  const { user, isUserLoading } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadImportRow[]>([]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setWarning(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const cid = (companyId ?? "").trim();
    if (!cid) {
      setError(null);
      setWarning(null);
      setRows([]);
      setLoading(false);
      return;
    }

    if (isUserLoading) {
      setLoading(true);
      setError(null);
      setWarning(null);
      setRows([]);
      return;
    }

    if (!user) {
      setLoading(false);
      setError("Pro načtení poptávek musíte být přihlášeni.");
      setWarning(null);
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setWarning(null);
    setRows([]);

    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/import-leads?companyId=${encodeURIComponent(cid)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );

        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (cancelled) return;

        const body = data as ApiErrorBody & Partial<ApiSuccessBody>;

        if (process.env.NODE_ENV === "development") {
          console.info("[LeadRequestsDialog] import-leads", {
            ok: res.ok,
            status: res.status,
            code: body?.code,
          });
        }

        if (!res.ok) {
          setError(messageForApiError(body, res.status));
          setRows([]);
          return;
        }

        if (body?.ok === true && Array.isArray(body.rows)) {
          setRows(body.rows);
          setWarning(
            typeof body.warning === "string" && body.warning.trim()
              ? body.warning.trim()
              : null
          );
          return;
        }

        setError("Neplatná odpověď serveru (očekáváno pole poptávek).");
        setRows([]);
      } catch (e) {
        if (!cancelled) {
          const msg =
            e instanceof Error && e.message
              ? e.message
              : "Nepodařilo se spojit s aplikací (síť nebo nedostupná služba).";
          setError(msg);
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, companyId, user, isUserLoading]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-white border-slate-200 text-slate-900 max-w-5xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col"
        data-portal-dialog
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Poptávky</DialogTitle>
          <DialogDescription>
            Data se načítají přes server z URL nastavené v Nastavení organizace
            (Import poptávek).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
          {!companyId?.trim() ? (
            <Alert>
              <AlertTitle>Chybí organizace</AlertTitle>
              <AlertDescription>
                Váš profil nemá přiřazenou firmu. Poptávky nelze načíst.
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
          ) : (
            <>
              {warning ? (
                <Alert>
                  <AlertTitle>Upozornění</AlertTitle>
                  <AlertDescription className="break-words">
                    {warning}
                  </AlertDescription>
                </Alert>
              ) : null}
              {rows.length === 0 ? (
                <p className="text-sm text-slate-600 py-4">
                  Žádné záznamy k zobrazení.
                </p>
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
                          <TableCell className="align-top text-sm">
                            {r.jmeno || "—"}
                          </TableCell>
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
