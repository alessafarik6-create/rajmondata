"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Factory, Loader2 } from "lucide-react";
import { DashboardCompactCard } from "@/components/portal/dashboard-compact-card";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
import { formatTimeCs } from "@/lib/production-qr/format-datetime-cs";

export type ActiveProductionWorkerRow = {
  entryId: string;
  employeeId: string;
  employeeName: string;
  jobId: string;
  jobName: string;
  taskId: string;
  taskName: string;
  startedAt: string | null;
  runningSeconds: number;
};

type Props = {
  getToken: () => Promise<string>;
  compact?: boolean;
  refreshMs?: number;
};

export function useProductionActiveWorkers(getToken: () => Promise<string>, refreshMs = 20_000) {
  const [workers, setWorkers] = useState<ActiveProductionWorkerRow[]>([]);
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
    const t = window.setInterval(() => void load(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [getToken, refreshMs]);

  return { workers, loading };
}

export function DashboardProductionActiveCompact(props: Props) {
  const { workers, loading } = useProductionActiveWorkers(props.getToken, props.refreshMs ?? 20_000);

  return (
    <DashboardCompactCard
      title={`Aktuálně ve výrobě${workers.length ? ` – ${workers.length}` : ""}`}
      icon={<Factory className="h-4 w-4 text-orange-600" />}
      accentClass="border-l-orange-500"
      href="/portal/vyroba/pracujici"
      footerLabel="Zobrazit všechny"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : workers.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nikdo právě neeviduje QR výrobu.</p>
      ) : (
        <ul className="space-y-2 text-xs">
          {workers.slice(0, 4).map((w) => (
            <li key={w.entryId} className="border-b border-border/40 pb-1.5 last:border-0">
              <p className="font-semibold text-foreground">{w.employeeName}</p>
              <p className="text-muted-foreground truncate">
                <Link href={`/portal/vyroba/zakazky/${w.jobId}`} className="hover:underline">
                  {w.jobName}
                </Link>
                {" · "}
                {w.taskName}
              </p>
              <p className="text-muted-foreground tabular-nums">
                {w.startedAt ? `Od ${formatTimeCs(w.startedAt)}` : "—"}
                {" · "}
                {formatDurationCs(w.runningSeconds)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DashboardCompactCard>
  );
}
