"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Ruler, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LeadImportRow } from "@/lib/lead-import-parse";
import { buildMeasurementPrefillHref } from "@/lib/measurement-prefill-from-lead";
import { useUser } from "@/firebase";

type ApiErrorBody = {
  ok?: false;
  error?: string;
  code?: string;
  importUrlDebug?: string;
};

type ApiSuccessBody = {
  ok: true;
  rows: LeadImportRow[];
  warning?: string;
};

function messageForApiError(data: ApiErrorBody | null, httpStatus: number): string {
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
    case 502:
      return "Import poptávek selhal (zkontrolujte zprávu výše nebo nastavení URL).";
    default:
      return `Import poptávek selhal (HTTP ${httpStatus}).`;
  }
}

export type LeadRequestsSectionProps = {
  companyId: string | undefined;
  /** Zobrazit sekci a načíst data (přepínače z rodiče). */
  active: boolean;
  /** Uživatel smí plánovat zaměření — zobrazí tlačítko Zaměřit. */
  canScheduleMeasurement: boolean;
};

export function LeadRequestsSection({
  companyId,
  active,
  canScheduleMeasurement,
}: LeadRequestsSectionProps) {
  const { user, isUserLoading } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDebugUrl, setErrorDebugUrl] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadImportRow[]>([]);

  useEffect(() => {
    if (!active) {
      setError(null);
      setErrorDebugUrl(null);
      setWarning(null);
      setRows([]);
      setLoading(false);
      return;
    }

    const cid = (companyId ?? "").trim();
    if (!cid) {
      setError(null);
      setErrorDebugUrl(null);
      setWarning(null);
      setRows([]);
      setLoading(false);
      return;
    }

    if (isUserLoading) {
      setLoading(true);
      setError(null);
      setErrorDebugUrl(null);
      setWarning(null);
      setRows([]);
      return;
    }

    if (!user) {
      setLoading(false);
      setError("Pro načtení poptávek musíte být přihlášeni.");
      setErrorDebugUrl(null);
      setWarning(null);
      setRows([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorDebugUrl(null);
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
          console.info("[LeadRequestsSection] import-leads", {
            ok: res.ok,
            status: res.status,
            code: body?.code,
          });
        }

        if (!res.ok) {
          const dbg =
            typeof body.importUrlDebug === "string" && body.importUrlDebug.trim()
              ? body.importUrlDebug.trim()
              : null;
          setErrorDebugUrl(dbg);
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
        setErrorDebugUrl(null);
        setRows([]);
      } catch {
        if (!cancelled) {
          setErrorDebugUrl(null);
          setError("Nelze se připojit k URL");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [active, companyId, user, isUserLoading]);

  if (!companyId?.trim()) return null;

  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/80 pb-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg text-slate-900">
              <Inbox className="h-5 w-5 text-orange-500" />
              Poptávky
            </CardTitle>
            <CardDescription className="text-slate-600">
              Import z URL v nastavení organizace (server proxy). Použijte „Zaměřit“ pro naplánování návštěvy.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-600">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">Načítám poptávky…</p>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Chyba importu</AlertTitle>
            <AlertDescription className="space-y-2 break-words">
              <span className="block">{error}</span>
              {errorDebugUrl ? (
                <span className="block text-xs font-mono text-slate-700 opacity-90">
                  Volaná URL (bez parametrů): {errorDebugUrl}
                </span>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {warning ? (
              <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-950">
                <AlertTitle>Upozornění</AlertTitle>
                <AlertDescription>{warning}</AlertDescription>
              </Alert>
            ) : null}
            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-600">
                Žádné poptávky nebyly nalezeny.
              </p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 hover:bg-slate-50">
                        <TableHead className="min-w-[120px]">Jméno</TableHead>
                        <TableHead className="min-w-[110px]">Telefon</TableHead>
                        <TableHead className="min-w-[160px]">E-mail</TableHead>
                        <TableHead className="min-w-[180px] hidden lg:table-cell">Adresa</TableHead>
                        <TableHead className="min-w-[200px] hidden xl:table-cell">Zpráva</TableHead>
                        <TableHead className="w-[120px] text-right">Akce</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id} className="border-slate-200">
                          <TableCell className="align-top text-sm font-medium text-slate-900">
                            {r.jmeno || "—"}
                          </TableCell>
                          <TableCell className="align-top text-sm tabular-nums text-slate-800">
                            {r.telefon || "—"}
                          </TableCell>
                          <TableCell className="align-top text-sm break-all text-slate-800">
                            {r.email || "—"}
                          </TableCell>
                          <TableCell className="align-top text-sm whitespace-pre-wrap text-slate-700 hidden lg:table-cell max-w-[240px]">
                            {r.adresa || "—"}
                          </TableCell>
                          <TableCell className="align-top text-sm whitespace-pre-wrap text-slate-700 hidden xl:table-cell max-w-xs">
                            {r.zprava || "—"}
                          </TableCell>
                          <TableCell className="align-top text-right">
                            {canScheduleMeasurement ? (
                              <Button
                                asChild
                                size="sm"
                                className="min-h-[40px] bg-orange-500 hover:bg-orange-600 text-white border-0 shadow-md shadow-orange-500/20"
                              >
                                <Link href={buildMeasurementPrefillHref(r)}>
                                  <Ruler className="w-4 h-4 mr-1.5 inline" />
                                  Zaměřit
                                </Link>
                              </Button>
                            ) : (
                              <span className="text-xs text-slate-500">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="md:hidden space-y-3">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3"
                    >
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-900">{r.jmeno || "—"}</p>
                        <p className="text-sm text-slate-700">
                          <span className="text-slate-500">Tel.: </span>
                          {r.telefon || "—"}
                        </p>
                        <p className="text-sm text-slate-700 break-all">
                          <span className="text-slate-500">E-mail: </span>
                          {r.email || "—"}
                        </p>
                        {r.adresa ? (
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">
                            <span className="text-slate-500">Adresa: </span>
                            {r.adresa}
                          </p>
                        ) : null}
                        {r.zprava ? (
                          <p className="text-sm text-slate-600 whitespace-pre-wrap border-t border-slate-100 pt-2">
                            {r.zprava}
                          </p>
                        ) : null}
                      </div>
                      {canScheduleMeasurement ? (
                        <Button
                          asChild
                          className="w-full min-h-[44px] bg-orange-500 hover:bg-orange-600 text-white border-0 shadow-md shadow-orange-500/20"
                        >
                          <Link href={buildMeasurementPrefillHref(r)}>
                            <Ruler className="w-4 h-4 mr-2" />
                            Zaměřit
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
