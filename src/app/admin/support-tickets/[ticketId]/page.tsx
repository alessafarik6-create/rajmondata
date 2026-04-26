"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SupportChat } from "@/components/portal/support/SupportChat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TicketDetail = {
  id: string;
  organizationId?: string;
  organizationName?: string;
  subject?: string;
  status?: string;
  type?: string;
};

export default function AdminSupportTicketDetailPage() {
  const params = useParams();
  const ticketId = String(params?.ticketId || "").trim();
  const { toast } = useToast();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/superadmin/support-tickets/${encodeURIComponent(ticketId)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Chyba",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        setTicket(null);
        return;
      }
      const t = data.ticket as Record<string, unknown> | undefined;
      if (!t) {
        setTicket(null);
        return;
      }
      setTicket({
        id: String(t.id || ticketId),
        organizationId: String(t.organizationId || ""),
        organizationName: String(t.organizationName || ""),
        subject: String(t.subject || ""),
        status: String(t.status || ""),
        type: String(t.type || ""),
      });
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  const patchStatus = async (status: string) => {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/superadmin/support-tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Uložení se nezdařilo",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      toast({ title: "Uloženo" });
      await load();
    } finally {
      setStatusBusy(false);
    }
  };

  if (!ticketId) {
    return <p className="text-sm text-muted-foreground">Chybí ID ticketu.</p>;
  }

  if (loading && !ticket) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <p className="text-sm text-muted-foreground">
        Ticket nenalezen.{" "}
        <Link href="/admin/support-tickets" className="text-primary underline">
          Zpět na seznam
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/support-tickets" className="text-sm text-primary underline">
          ← Zpět na seznam
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{ticket.subject || "Ticket"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ticket.organizationName || "—"} <span className="font-mono text-xs">({ticket.organizationId})</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{ticket.type}</Badge>
          <Badge>{ticket.status}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stav ticketu</CardTitle>
          <CardDescription>Uzavřít může jen superadministrátor (provozovatel).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select
            value={ticket.status}
            onValueChange={(v) => void patchStatus(v)}
            disabled={statusBusy}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Otevřené</SelectItem>
              <SelectItem value="answered">Odpovězeno</SelectItem>
              <SelectItem value="closed">Uzavřené</SelectItem>
            </SelectContent>
          </Select>
          {statusBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konverzace</CardTitle>
          <CardDescription>Odpověď se uloží jako zpráva od provozovatele a stav přepne na „odpovězeno“.</CardDescription>
        </CardHeader>
        <CardContent>
          <SupportChat ticketId={ticketId} mode="admin" ticketStatus={ticket.status} />
        </CardContent>
      </Card>
    </div>
  );
}
