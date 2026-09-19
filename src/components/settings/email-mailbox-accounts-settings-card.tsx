"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/firebase";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { parseEmailApiResponse } from "@/lib/email-mailbox/client-fetch";

type OrgMemberRow = {
  userId: string;
  displayName: string;
  connected: boolean;
  mailboxes: { email: string; status: string; statusLabel: string; accountType: string }[];
};

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
          Přehled připojení schránek v týmu. Obsah osobních e-mailů zde nevidíte — každý uživatel spravuje
          schránku v Profil → Můj e-mail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="ghost" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Zatím není připojena žádná schránka v týmu.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="font-medium">{m.displayName}</span>
                <span className={m.connected ? "text-green-600" : "text-muted-foreground"}>
                  {m.connected
                    ? m.mailboxes.map((b) => `${b.email} (${b.statusLabel})`).join(", ")
                    : "Nepřipojeno"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
