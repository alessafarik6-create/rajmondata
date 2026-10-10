"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Factory, Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useProductionActiveWorkers,
  type ActiveProductionWorkerRow,
} from "@/components/production/production-active-workers-dashboard";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
import { formatTimeCs } from "@/lib/production-qr/format-datetime-cs";
import { VYROBA_CARD } from "@/lib/production-mobile-ui";

export default function ProductionWorkforcePage() {
  const { user } = useUser();
  const getToken = async () => {
    if (!user) throw new Error("Nepřihlášen");
    return user.getIdToken();
  };
  const { workers, loading } = useProductionActiveWorkers(getToken, 15_000);

  const [jobFilter, setJobFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState("");

  const filtered = useMemo(() => {
    const jf = jobFilter.trim().toLowerCase();
    const ef = employeeFilter.trim().toLowerCase();
    const tf = taskFilter.trim().toLowerCase();
    return workers.filter((w) => {
      if (jf && !w.jobName.toLowerCase().includes(jf) && !w.jobId.toLowerCase().includes(jf))
        return false;
      if (ef && !w.employeeName.toLowerCase().includes(ef)) return false;
      if (tf && !w.taskName.toLowerCase().includes(tf)) return false;
      return true;
    });
  }, [workers, jobFilter, employeeFilter, taskFilter]);

  const byJob = useMemo(() => {
    const map = new Map<string, { jobName: string; count: number; seconds: number }>();
    for (const w of filtered) {
      const cur = map.get(w.jobId) ?? { jobName: w.jobName, count: 0, seconds: 0 };
      cur.count += 1;
      cur.seconds += w.runningSeconds;
      map.set(w.jobId, cur);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totalRunningSeconds = filtered.reduce((s, w) => s + w.runningSeconds, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/portal/dashboard">
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Link>
        </Button>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Factory className="h-5 w-5 text-orange-600" />
          Kdo právě pracuje
        </h1>
      </div>

      <Card className={VYROBA_CARD}>
        <CardHeader>
          <CardTitle className="text-base">Aktivní QR výroba</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="Filtr zakázka" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} />
            <Input placeholder="Filtr zaměstnanec" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} />
            <Input placeholder="Filtr úkol" value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)} />
          </div>

          <p className="text-sm text-muted-foreground">
            Pracujících: <strong>{filtered.length}</strong>
            {" · "}
            Součet běžících časů: <strong>{formatDurationCs(totalRunningSeconds)}</strong>
          </p>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné aktivní výrobní relace.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((w) => (
                <WorkerRow key={w.entryId} w={w} />
              ))}
            </ul>
          )}

          {byJob.length > 0 ? (
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-semibold">Podle zakázky</p>
              <ul className="text-sm space-y-1">
                {byJob.map(([jobId, info]) => (
                  <li key={jobId}>
                    <Link href={`/portal/vyroba/zakazky/${jobId}`} className="text-primary hover:underline">
                      {info.jobName}
                    </Link>
                    {" — "}
                    {info.count} pracovník(ů), {formatDurationCs(info.seconds)} celkem
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkerRow({ w }: { w: ActiveProductionWorkerRow }) {
  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
      <p className="font-semibold">{w.employeeName}</p>
      <p>
        Zakázka:{" "}
        <Link href={`/portal/vyroba/zakazky/${w.jobId}`} className="text-primary hover:underline">
          {w.jobName}
        </Link>
      </p>
      <p>Úkol: {w.taskName}</p>
      <p className="text-muted-foreground tabular-nums">
        Pracuje od: {w.startedAt ? formatTimeCs(w.startedAt) : "—"} · Doba:{" "}
        {formatDurationCs(w.runningSeconds)} · <span className="text-emerald-700">Aktivní</span>
      </p>
    </li>
  );
}
