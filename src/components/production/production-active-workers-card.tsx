"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";

type Worker = {
  employeeName: string;
  taskName: string;
  jobName: string;
  runningSeconds: number;
};

type Props = {
  getToken: () => Promise<string>;
};

export function ProductionActiveWorkersCard({ getToken }: Props) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/company/production/active-workers", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && data.ok) setWorkers(data.workers ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [getToken]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }
  if (workers.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Právě ve výrobě</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {workers.map((w, i) => (
          <div key={i} className="text-sm border-b border-border/60 pb-2 last:border-0">
            <p className="font-medium">{w.employeeName}</p>
            <p className="text-muted-foreground">{w.taskName}</p>
            <p className="text-muted-foreground">{w.jobName}</p>
            <p className="tabular-nums text-orange-700">běží {formatDurationCs(w.runningSeconds)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
