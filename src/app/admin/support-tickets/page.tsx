"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TicketRow = {
  id: string;
  organizationId?: string;
  organizationName?: string;
  type?: string;
  subject?: string;
  status?: string;
  lastMessageText?: string | null;
  updatedAt?: string | null;
};

function typeLabel(t: string | undefined): string {
  switch (t) {
    case "dotaz":
      return "Dotaz";
    case "napad":
      return "Nápad";
    case "feature":
      return "Nová funkce";
    default:
      return t || "—";
  }
}

function statusLabel(s: string | undefined): string {
  switch (s) {
    case "open":
      return "Otevřené";
    case "answered":
      return "Odpovězeno";
    case "closed":
      return "Uzavřené";
    default:
      return s || "—";
  }
}

export default function AdminSupportTicketsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (statusFilter !== "all") q.set("status", statusFilter);
      if (typeFilter !== "all") q.set("type", typeFilter);
      const res = await fetch(`/api/superadmin/support-tickets?${q.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.tickets) ? data.tickets : []);
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Podpora / dotazy organizací</h1>
        <p className="text-muted-foreground mt-2">Tickety z portálu organizací — filtrujte podle stavu a typu.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Seznam ticketů</CardTitle>
            <CardDescription>Organizace, předmět, poslední zpráva, stav.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Stav" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny stavy</SelectItem>
                <SelectItem value="open">Otevřené</SelectItem>
                <SelectItem value="answered">Odpovězeno</SelectItem>
                <SelectItem value="closed">Uzavřené</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Typ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny typy</SelectItem>
                <SelectItem value="dotaz">Dotaz</SelectItem>
                <SelectItem value="napad">Nápad</SelectItem>
                <SelectItem value="feature">Nová funkce</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Obnovit"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && rows.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné tickety.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/admin/support-tickets/${t.id}`}
                    className="block px-3 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{t.subject || "(bez předmětu)"}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.updatedAt ? new Date(t.updatedAt).toLocaleString("cs-CZ") : "—"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {(t.organizationName || "—") + (t.organizationId ? ` · ${t.organizationId}` : "")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">{typeLabel(t.type)}</span>
                      <span className="rounded border border-border px-2 py-0.5 text-xs">{statusLabel(t.status)}</span>
                    </div>
                    {t.lastMessageText ? (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{t.lastMessageText}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
