"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, PencilRuler } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

type ExtModule = {
  code: string;
  name: string;
  description: string;
  active: boolean;
  orgLicensed: boolean;
  isTrial: boolean;
  expiresAt: string | null;
  paymentStatus: string;
  priceMonthlyCzk: number;
  priceYearlyCzk: number;
  seatCount: number;
  assignedUsers: number;
  trialDays: number;
  integrationStatus: string;
};

export default function MojeModulyPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<ExtModule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/my-modules", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await res.json();
      if (data.ok) setModules(data.modules ?? []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function launch(code: string) {
    if (!user) return;
    setBusy(code);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/company/modules/${encodeURIComponent(code)}/launch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Spuštění selhalo");
      window.location.href = data.redirectUrl;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Editor",
        description: e instanceof Error ? e.message : "Chyba",
      });
    } finally {
      setBusy(null);
    }
  }

  async function orderModule(code: string) {
    if (!user) return;
    setBusy(code);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/company/platform-invoices/module-activation", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ moduleId: code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Objednávka selhala");
      toast({ title: "Faktura vystavena", description: "Pokračujte ve Vyúčtování služeb." });
    } catch (e) {
      toast({ variant: "destructive", title: "Objednávka", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
    }
  }

  function cta(m: ExtModule) {
    if (m.active) {
      return (
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-black"
          disabled={busy === m.code}
          onClick={() => void launch(m.code)}
        >
          {busy === m.code ? <Loader2 className="h-4 w-4 animate-spin" /> : "Spustit editor"}
        </Button>
      );
    }
    if (m.paymentStatus === "trial" || (!m.orgLicensed && m.trialDays > 0)) {
      return (
        <Button variant="secondary" asChild>
          <Link href="/portal/vyuctovani">Vyzkoušet zdarma / aktivovat</Link>
        </Button>
      );
    }
    if (m.expiresAt && Date.parse(m.expiresAt) < Date.now()) {
      return (
        <Button variant="outline" asChild>
          <Link href="/portal/vyuctovani">Prodloužit licenci</Link>
        </Button>
      );
    }
    if (m.paymentStatus === "unpaid" || m.paymentStatus === "free") {
      return (
        <Button disabled={busy === m.code} onClick={() => void orderModule(m.code)}>
          Objednat předplatné
        </Button>
      );
    }
    return (
      <Button variant="outline" asChild>
        <Link href="/portal/vyuctovani">Aktivovat modul</Link>
      </Button>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Moje moduly</h1>
        <p className="text-sm text-muted-foreground">Externí aplikace propojené s vaší organizací.</p>
      </div>
      {loading ? (
        <Loader2 className="h-8 w-8 animate-spin" />
      ) : modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">Žádné externí moduly nejsou v katalogu aktivní.</p>
      ) : (
        modules.map((m) => (
          <Card key={m.code}>
            <CardHeader className="flex flex-row items-start gap-3">
              <PencilRuler className="h-8 w-8 text-orange-500 shrink-0" />
              <div>
                <CardTitle>{m.name}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">{m.description}</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  Stav licence:{" "}
                  <strong>{m.active ? (m.isTrial ? "Zkušební" : "Aktivní") : "Neaktivní"}</strong>
                </div>
                <div>
                  Cena: <strong>{m.priceMonthlyCzk} Kč / měs.</strong>
                  {m.priceYearlyCzk ? ` · ročně ${m.priceYearlyCzk} Kč` : null}
                </div>
                <div>
                  Uživatelské licence: {m.assignedUsers} / {m.seatCount}
                </div>
                <div>Platnost: {m.expiresAt ? new Date(m.expiresAt).toLocaleDateString("cs-CZ") : "—"}</div>
                <div className="sm:col-span-2 text-xs text-muted-foreground">
                  Integrace editoru: {m.integrationStatus}
                </div>
              </div>
              {cta(m)}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
