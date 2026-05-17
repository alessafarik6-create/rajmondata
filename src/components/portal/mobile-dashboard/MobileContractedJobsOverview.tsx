"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Firestore } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import {
  buildContractedJobsExportBundle,
  formatMoneyKc,
  type ContractedDepositTimelineEvent,
  type ContractedJobsExportSummary,
} from "@/lib/contracted-jobs-export";

const PIE_COLORS = {
  paid: "#f97316",
  remaining: "#475569",
};

export function MobileContractedJobsOverview(props: {
  companyId: string;
  jobs: Array<Record<string, unknown> & { id: string }>;
  customersById: Map<string, Record<string, unknown>>;
  enabled?: boolean;
}) {
  const firestore = useFirestore();
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContractedJobsExportSummary | null>(null);
  const [timeline, setTimeline] = useState<ContractedDepositTimelineEvent[]>([]);

  const jobsKey = useMemo(
    () =>
      props.jobs
        .map((j) => String(j.id ?? "").trim())
        .filter(Boolean)
        .sort()
        .join(","),
    [props.jobs]
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!props.enabled || !firestore || !props.companyId) {
      setSummary(null);
      setTimeline([]);
      setLoadError(null);
      return;
    }

    const jobsPayload = props.jobs
      .map((j) => {
        const id = String(j.id ?? "").trim();
        if (!id) return null;
        return { ...(j as Record<string, unknown>), id };
      })
      .filter(Boolean) as Array<Record<string, unknown> & { id: string }>;

    if (jobsPayload.length === 0) {
      setSummary({
        jobCount: 0,
        totalPriceGross: 0,
        totalRequiredDepositGross: 0,
        totalReceivedDepositGross: 0,
        totalDepositRemainingGross: 0,
        totalDepositReceivedGross: 0,
        totalRemainingToPayGross: 0,
        paidByVatGroups: [],
      });
      setTimeline([]);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void buildContractedJobsExportBundle({
      firestore: firestore as Firestore,
      companyId: props.companyId,
      jobs: jobsPayload,
      customersById: props.customersById,
    })
      .then((bundle) => {
        if (cancelled) return;
        setSummary(bundle.summary);
        setTimeline(bundle.timelineEvents);
      })
      .catch((e) => {
        if (cancelled) return;
        setSummary(null);
        setTimeline([]);
        setLoadError(e instanceof Error ? e.message : "Nepodařilo se načíst přehled.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [props.enabled, props.companyId, firestore, jobsKey, props.customersById, props.jobs]);

  const pieData = useMemo(() => {
    if (!summary) return [];
    const paid = Math.max(0, summary.totalReceivedDepositGross);
    const remaining = Math.max(0, summary.totalRemainingToPayGross);
    if (paid <= 0.009 && remaining <= 0.009) return [];
    return [
      { name: "Zaplaceno", value: paid, fill: PIE_COLORS.paid },
      { name: "Zbývá doplatit", value: remaining, fill: PIE_COLORS.remaining },
    ];
  }, [summary]);

  const hasPie = pieData.some((d) => d.value > 0.009);

  if (!props.enabled) return null;

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <h3 className="text-sm font-semibold tracking-wide text-slate-200">
        Zesmluvněné zakázky
      </h3>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {loadError}
        </p>
      ) : summary && summary.jobCount === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-400">
          Zatím nejsou žádné zesmluvněné zakázky.
        </p>
      ) : summary ? (
        <>
          <ContractedJobsPieChart hasPie={hasPie} isMounted={isMounted} pieData={pieData} />
          <SummaryStats summary={summary} />
          <DepositTimeline events={timeline} />
        </>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
      <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
      Načítám přehled…
    </div>
  );
}

function ContractedJobsPieChart(props: {
  hasPie: boolean;
  isMounted: boolean;
  pieData: { name: string; value: number; fill: string }[];
}) {
  const { hasPie, isMounted, pieData } = props;
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <ContractedJobsChartArea hasPie={hasPie} isMounted={isMounted} pieData={pieData} />
    </div>
  );
}

function ContractedJobsChartArea(props: {
  hasPie: boolean;
  isMounted: boolean;
  pieData: { name: string; value: number; fill: string }[];
}) {
  const { hasPie, isMounted, pieData } = props;
  return (
    <div className="mx-auto h-[200px] w-full max-w-[min(100%,320px)]">
      {hasPie && isMounted ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={72}
              dataKey="value"
              paddingAngle={2}
            >
              {pieData.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => formatMoneyKc(value)}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "8px",
                color: "#f8fafc",
                fontSize: "12px",
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: "11px", color: "#cbd5e1" }}
              formatter={(value) => <span className="text-slate-300">{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full items-center justify-center text-center">
          <p className="text-xs text-slate-400">
            Zatím bez platebních údajů k zobrazení grafu.
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryStats(props: { summary: ContractedJobsExportSummary }) {
  const { summary } = props;
  const items = [
    { label: "Počet zesmluvněných zakázek", value: String(summary.jobCount) },
    { label: "Součet cen zakázek", value: formatMoneyKc(summary.totalPriceGross) },
    { label: "Součet přijatých plateb", value: formatMoneyKc(summary.totalReceivedDepositGross) },
    { label: "Součet zbývá doplatit", value: formatMoneyKc(summary.totalRemainingToPayGross) },
    {
      label: "Součet přijatých záloh",
      value: formatMoneyKc(summary.totalDepositReceivedGross),
    },
  ];

  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {item.label}
          </dt>
          <dd className="mt-0.5 break-words text-base font-bold tabular-nums text-white">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DepositTimeline(props: { events: ContractedDepositTimelineEvent[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
        Časová osa přijatých záloh
      </h4>
      {props.events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 px-3 py-3 text-center text-xs text-slate-400">
          Zatím žádné zaznamenané platby záloh.
        </p>
      ) : (
        <ul className="min-w-0 space-y-2">
          {props.events.map((ev, idx) => (
            <li
              key={`${ev.jobId}-${ev.paidAtIso ?? "nd"}-${ev.amountGross}-${idx}`}
              className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <TimelineRow ev={ev} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineRow(props: { ev: ContractedDepositTimelineEvent }) {
  const { ev } = props;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-orange-200">{ev.paidAtLabel}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-white">
          {formatMoneyKc(ev.amountGross)}
        </span>
      </div>
      <p className="mt-1 break-words text-sm font-medium text-slate-100">{ev.jobName}</p>
      <p className="break-words text-xs text-slate-400">{ev.customer}</p>
      <p className="mt-1 break-words text-[11px] text-slate-300">{ev.sourceLabel}</p>
    </>
  );
}
