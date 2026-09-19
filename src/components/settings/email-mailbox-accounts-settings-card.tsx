"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";

type OrgMailboxRow = {
  email: string;
  status: string;
  statusLabel: string;
  accountType: string;
  provider: string;
  lastSyncAt: string | null;
  isActive: boolean;
};

type OrgMemberRow = {
  userId: string;
  displayName: string;
  connected: boolean;
  connectedAccountCount: number;
  totalAccountCount: number;
  mailboxes: OrgMailboxRow[];
};

function formatLastSync(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ");
  } catch {
    return "—";
  }
}

export function EmailMailboxAccountsSettingsCard({ companyId }: { companyId: string | null }) {
  const { user } = useUser();
  const { toast } = useToast();
  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !companyId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/company/email-mailbox/org-status?companyId=${encodeURIComponent(companyId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await parseEmailApiResponse<{ members?: OrgMemberRow[] }>(res);
      if (data.ok && Array.isArray(data.members)) setMembers(data.members);
      else if (!data.ok) {
        toast({
          variant: "destructive",
          title: "E-mailová komunikace",
          description: data.message ?? data.error ?? "Nepodařilo se načíst stav.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [user, companyId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!companyId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> E-mailová komunikace (organizace)
        </CardTitle>
        <CardDescription>
          Přehled připojení schránek v týmu — pouze metadata (e-mail, provider, stav, sync). Obsah zpráv admin
          nevidí. Každý uživatel spravuje účty v Profil → Moje e-mailové účty.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="ghost" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím není připojena žádná schránka v týmu.</p>
        ) : (
          <ul className="space-y-3">
            {members.map((m) => (
              <li key={m.userId} className="rounded-lg border px-3 py-3 text-sm space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{m.displayName}</span>
                  <span className={m.connected ? "text-green-600" : "text-muted-foreground"}>
                    {m.connected
                      ? `${m.connectedAccountCount} ${m.connectedAccountCount === 1 ? "účet" : m.connectedAccountCount < 5 ? "účty" : "účtů"} připojeno`
                      : m.totalAccountCount > 0
                        ? `${m.totalAccountCount} účtů (vše odpojeno)`
                        : "Nepřipojeno"}
                  </span>
                </div>
                {m.mailboxes.length > 0 ? (
                  <ul className="space-y-1.5 pl-0 border-t pt-2">
                    {m.mailboxes.map((b) => (
                      <li
                        key={`${m.userId}-${b.email}`}
                        className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between text-muted-foreground"
                      >
                        <span className="font-mono text-xs sm:text-sm text-foreground break-all">{b.email}</span>
                        <span className="text-xs">
                          {b.provider} · {b.statusLabel}
                          {!b.isActive ? " · odpojeno" : ""}
                          {" · sync "}
                          {formatLastSync(b.lastSyncAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
