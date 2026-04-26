"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where, limit } from "firebase/firestore";
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase";
import { doc } from "firebase/firestore";
import { SUPPORT_TICKETS_COLLECTION } from "@/lib/firestore-collections";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type TicketRow = {
  id: string;
  subject?: string;
  type?: string;
  status?: string;
  lastMessageText?: string | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
};

function parseTs(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && "toDate" in raw && typeof (raw as { toDate: () => Date }).toDate === "function") {
    try {
      return (raw as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function typeLabel(t: string | undefined): string {
  switch (t) {
    case "dotaz":
      return "Dotaz";
    case "napad":
      return "Nápad na zlepšení";
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

export function SupportPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();

  const userRef = useMemoFirebase(() => (user && firestore ? doc(firestore, "users", user.uid) : null), [
    firestore,
    user,
  ]);
  const { data: profile } = useDoc(userRef);
  const companyId = (profile?.companyId ?? profile?.organizationId) as string | undefined;
  const role = (profile?.role as string) || "employee";
  const canUse = role === "owner" || role === "admin" || role === "manager" || role === "accountant";

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [formType, setFormType] = useState<string>("dotaz");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const ticketsQuery = useMemoFirebase(() => {
    if (!firestore || !companyId || !canUse) return null;
    return query(
      collection(firestore, SUPPORT_TICKETS_COLLECTION),
      where("organizationId", "==", companyId),
      limit(80)
    );
  }, [firestore, companyId, canUse]);

  useEffect(() => {
    if (!ticketsQuery) {
      setTickets([]);
      return;
    }
    const unsub = onSnapshot(
      ticketsQuery,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            subject: String(x.subject || ""),
            type: String(x.type || ""),
            status: String(x.status || ""),
            lastMessageText: x.lastMessageText != null ? String(x.lastMessageText) : null,
            updatedAt: parseTs(x.updatedAt),
            createdAt: parseTs(x.createdAt),
          };
        });
        rows.sort((a, b) => {
          const au = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
          const bu = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
          return bu - au;
        });
        setTickets(rows);
      },
      (err) => {
        console.error("[SupportPage] tickets snapshot", err);
        toast({
          variant: "destructive",
          title: "Nelze načíst tickety",
          description: err.message,
        });
      }
    );
    return () => unsub();
  }, [ticketsQuery, toast]);

  const submit = async () => {
    if (!user) return;
    const sub = subject.trim();
    const msg = message.trim();
    if (!sub || !msg) {
      toast({ variant: "destructive", title: "Vyplňte předmět i zprávu." });
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/support-tickets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: formType, subject: sub, message: msg }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Odeslání se nezdařilo",
          description: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      toast({ title: "Odesláno", description: "Váš dotaz byl uložen. Odpovíme co nejdříve." });
      setSubject("");
      setMessage("");
    } catch {
      toast({ variant: "destructive", title: "Chyba sítě." });
    } finally {
      setSubmitting(false);
    }
  };

  if (!companyId) {
    return <p className="text-sm text-muted-foreground">Nejste přiřazeni k organizaci.</p>;
  }

  if (!canUse) {
    return (
      <p className="text-sm text-muted-foreground">
        Kontaktovat podporu mohou vlastník, administrátor, manažer nebo účetní.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Kontaktovat podporu / návrh na zlepšení</CardTitle>
          <CardDescription>
            Napište dotaz na provozovatele platformy, nápad na vylepšení nebo požadavek na novou funkci.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Typ zprávy</Label>
            <Select value={formType} onValueChange={setFormType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dotaz">Dotaz</SelectItem>
                <SelectItem value="napad">Nápad na zlepšení</SelectItem>
                <SelectItem value="feature">Nová funkce</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="support-subject">Předmět</Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="support-body">Zpráva</Label>
            <Textarea
              id="support-body"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              className="resize-y min-h-[120px]"
            />
          </div>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Odeslat"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vaše dotazy</CardTitle>
          <CardDescription>Přehled konverzací se stavem a poslední zprávou.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím nemáte žádné odeslané dotazy.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/portal/help/${t.id}`}
                    className="block px-3 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">{t.subject || "(bez předmětu)"}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.updatedAt ? t.updatedAt.toLocaleString("cs-CZ") : "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="rounded bg-muted px-2 py-0.5">{typeLabel(t.type)}</span>
                      <span className="rounded border border-border px-2 py-0.5">{statusLabel(t.status)}</span>
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
