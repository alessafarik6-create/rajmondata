"use client";

import React, { useState } from "react";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

type BulkRefreshResponse = {
  ok?: boolean;
  processed?: Array<{ invoiceId: string; ok: boolean; error?: string }>;
  nextStartAfterId?: string | null;
  done?: boolean;
  error?: string;
};

export function PortalInvoicePdfBulkRefresh({
  user,
  className,
}: {
  user: User | null | undefined;
  className?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastReport, setLastReport] = useState<string | null>(null);

  const runBatch = async (startAfterId: string | null): Promise<string | null> => {
    if (!user) throw new Error("Nejste přihlášeni.");
    const token = await user.getIdToken();
    const res = await fetch("/api/company/portal-invoices/bulk-refresh-pdf-preview", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 25, startAfterId }),
    });
    const j = (await res.json().catch(() => ({}))) as BulkRefreshResponse;
    if (!res.ok || !j.ok) throw new Error(j.error || "Hromadná aktualizace selhala.");
    const batch = j.processed ?? [];
    const okCount = batch.filter((r) => r.ok).length;
    const failCount = batch.length - okCount;
    setLastReport(`Dávka: ${okCount} OK, ${failCount} chyb (celkem ${batch.length}).`);
    if (failCount > 0) {
      const sample = batch
        .filter((r) => !r.ok)
        .slice(0, 3)
        .map((r) => `${r.invoiceId}: ${r.error ?? "?"}`)
        .join("; ");
      setLastReport((prev) => `${prev ?? ""} Chyby: ${sample}`);
    }
    return j.done ? null : j.nextStartAfterId ?? null;
  };

  const handleBulk = async () => {
    if (!user || busy) return;
    setBusy(true);
    setProgress(5);
    setLastReport(null);
    try {
      let cursor: string | null = null;
      let steps = 0;
      do {
        cursor = await runBatch(cursor);
        steps += 1;
        setProgress(Math.min(95, steps * 12));
      } while (cursor && steps < 200);
      setProgress(100);
      toast({
        title: "Hromadná aktualizace dokončena",
        description: "Náhledy PDF byly přegenerovány bez změny účetních údajů.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Hromadná aktualizace",
        description: e instanceof Error ? e.message : "Operace selhala.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={busy}
        onClick={() => void handleBulk()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Hromadně aktualizovat náhledy faktur
      </Button>
      {busy ? <Progress value={progress} className="mt-2 h-2" /> : null}
      {lastReport ? <p className="mt-2 text-xs text-neutral-600">{lastReport}</p> : null}
    </div>
  );
}
