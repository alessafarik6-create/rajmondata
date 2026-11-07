"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Factory, Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { usePortalModuleAccess } from "@/hooks/use-portal-module-access";
import {
  liveProductionWorkedSeconds,
  useProductionActiveWorkers,
  type ActiveProductionWorkerRow,
} from "@/components/production/production-active-workers-dashboard";
import { formatDurationCs } from "@/lib/production-qr/format-duration-cs";
import { formatTimeCs } from "@/lib/production-qr/format-datetime-cs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PREVIEW_COUNT = 6;

export function MobileProductionActiveWorkers() {
  const { user } = useUser();
  const vyrobaAccess = usePortalModuleAccess("vyroba");
  const employeesAccess = usePortalModuleAccess("employees");

  const getToken = async () => {
    if (!user) throw new Error("Nepřihlášen");
    return user.getIdToken();
  };

  const { workers, loading, fetchedAt } = useProductionActiveWorkers(getToken, 20_000);
  const [selected, setSelected] = useState<ActiveProductionWorkerRow | null>(null);

  const preview = useMemo(() => workers.slice(0, PREVIEW_COUNT), [workers]);

  if (!vyrobaAccess.canRead || !user) return null;

  return (
    <>
      <section
        aria-label="Aktuálně ve výrobě"
        className="min-w-0 max-w-full overflow-x-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-orange-500/25 to-transparent">
            <Factory className="h-5 w-5 text-orange-300" />
          </div>
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-white">
            Aktuálně ve výrobě
            {workers.length > 0 ? (
              <span className="text-orange-300"> – {workers.length}</span>
            ) : null}
          </h2>
        </div>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : workers.length === 0 ? (
          <p className="text-sm text-slate-400">Nikdo právě neeviduje QR výrobu.</p>
        ) : (
          <ul className="space-y-3">
            {preview.map((w) => (
              <li key={w.entryId}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-xl border border-white/10 bg-slate-900/40 p-3 text-left",
                    "min-h-[44px] active:scale-[0.99] transition-transform"
                  )}
                  onClick={() => setSelected(w)}
                >
                  <p className="text-sm font-semibold text-white">{w.employeeName}</p>
                  <p className="mt-0.5 text-xs text-slate-300">
                    <span className="text-slate-400">Zakázka: </span>
                    <span className="break-words">{w.jobName}</span>
                  </p>
                  <p className="text-xs text-slate-300">
                    <span className="text-slate-400">Operace: </span>
                    <span className="break-words">{w.taskName}</span>
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-orange-200">
                    {w.startedAt ? `Od ${formatTimeCs(w.startedAt)}` : "—"}
                    {" · "}
                    {formatDurationCs(liveProductionWorkedSeconds(w, fetchedAt))}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/portal/vyroba/pracujici"
          className="mt-4 flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-sm font-medium text-orange-200 active:bg-white/5"
        >
          Zobrazit všechny
          <ChevronRight className="h-4 w-4 shrink-0" />
        </Link>
      </section>

      <Sheet open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[min(88dvh,640px)] rounded-t-2xl border-white/10 bg-slate-950 text-slate-50 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          {selected ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-lg text-white">{selected.employeeName}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-3 text-sm">
                <DetailLine label="Zakázka" value={selected.jobName} />
                <DetailLine label="Operace" value={selected.taskName} />
                <DetailLine
                  label="Zahájení"
                  value={
                    selected.sessionStartedAt || selected.startedAt
                      ? formatTimeCs(selected.sessionStartedAt ?? selected.startedAt!)
                      : "—"
                  }
                />
                <DetailLine
                  label="Doba práce"
                  value={formatDurationCs(liveProductionWorkedSeconds(selected, fetchedAt))}
                />
                <DetailLine label="QR záznam" value={selected.entryId} mono />
                {selected.qrStatusLabel ? (
                  <DetailLine label="Stav" value={selected.qrStatusLabel} />
                ) : null}
              </div>
              <div className="mt-6 flex flex-col gap-2">
                {vyrobaAccess.canRead ? (
                  <Button
                    asChild
                    className="min-h-11 w-full bg-orange-600 hover:bg-orange-700"
                  >
                    <Link href={`/portal/vyroba/zakazky/${selected.jobId}`}>Otevřít zakázku</Link>
                  </Button>
                ) : null}
                {vyrobaAccess.canRead ? (
                  <Button asChild variant="secondary" className="min-h-11 w-full border-white/15 bg-white/10">
                    <Link
                      href={`/portal/vyroba/zakazky/${selected.jobId}#production-task-${selected.taskId}`}
                    >
                      Zobrazit výrobní operaci
                    </Link>
                  </Button>
                ) : null}
                {employeesAccess.canRead && selected.employeeId ? (
                  <Button asChild variant="outline" className="min-h-11 w-full border-white/20 bg-transparent">
                    <Link href={`/portal/employees/${selected.employeeId}?tab=work-report`}>
                      Pracovní výkaz zaměstnance
                    </Link>
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function DetailLine(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{props.label}</p>
      <p
        className={cn(
          "mt-0.5 break-words text-slate-100",
          props.mono && "font-mono text-xs text-slate-300"
        )}
      >
        {props.value}
      </p>
    </div>
  );
}
