"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  Receipt,
  Download,
  Loader2,
  BarChart as BarChartIcon,
} from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { doc, collection, query, orderBy, limit } from "firebase/firestore";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  Pie,
  PieChart,
  Line,
  LineChart,
  CartesianGrid,
  Legend,
} from "recharts";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const MONTH_NAMES_CS = [
  "Leden",
  "Únor",
  "Březen",
  "Duben",
  "Květen",
  "Červen",
  "Červenec",
  "Srpen",
  "Září",
  "Říjen",
  "Listopad",
  "Prosinec",
];

function parseRecordDate(raw: unknown): Date | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t);
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    "toDate" in raw &&
    typeof (raw as { toDate: () => Date }).toDate === "function"
  ) {
    return (raw as { toDate: () => Date }).toDate();
  }
  return null;
}

export default function FinancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;
  const role = profile?.role || "employee";

  const canAccess = ["owner", "admin", "accountant"].includes(role);

  const jobsQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "jobs")
        : null,
    [firestore, companyId]
  );
  const financeQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(
            collection(firestore, "companies", companyId, "finance"),
            orderBy("date", "desc"),
            limit(200)
          )
        : null,
    [firestore, companyId]
  );

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } =
    useCollection(financeQuery);

  const stats = useMemo(() => {
    if (!financeRecords)
      return { revenue: 0, costs: 0, profit: 0, activeJobs: 0 };

    const revenue = financeRecords
      .filter((r: { type?: string }) => r.type === "revenue")
      .reduce((sum, r: { amount?: unknown }) => sum + Number(r.amount), 0);
    const costs = financeRecords
      .filter((r: { type?: string }) => r.type === "expense")
      .reduce((sum, r: { amount?: unknown }) => sum + Number(r.amount), 0);
    const profit = revenue - costs;

    return {
      revenue,
      costs,
      profit,
      activeJobs:
        jobs?.filter(
          (j: { status?: string }) =>
            j.status !== "dokončená" && j.status !== "fakturována"
        ).length || 0,
    };
  }, [financeRecords, jobs]);

  const chartData = useMemo(() => {
    if (!financeRecords?.length) return [];
    const year = new Date().getFullYear();
    const buckets: Record<number, { revenue: number; costs: number }> = {};

    for (const r of financeRecords as {
      type?: string;
      amount?: unknown;
      date?: unknown;
    }[]) {
      const dt = parseRecordDate(r.date);
      if (!dt || dt.getFullYear() !== year) continue;
      const mi = dt.getMonth();
      if (!buckets[mi]) buckets[mi] = { revenue: 0, costs: 0 };
      const amt = Number(r.amount) || 0;
      if (r.type === "revenue") buckets[mi].revenue += amt;
      else if (r.type === "expense") buckets[mi].costs += amt;
    }

    const keys = Object.keys(buckets)
      .map(Number)
      .sort((a, b) => a - b);
    return keys.map((mi) => ({
      name: MONTH_NAMES_CS[mi],
      revenue: buckets[mi].revenue,
      costs: buckets[mi].costs,
    }));
  }, [financeRecords]);

  const pieData = useMemo(() => {
    if (stats.revenue <= 0 && stats.costs <= 0) return [];
    const rows: { name: string; value: number; fill: string }[] = [];
    if (stats.costs > 0) {
      rows.push({
        name: "Výdaje",
        value: stats.costs,
        fill: "hsl(var(--primary))",
      });
    }
    if (stats.revenue > 0) {
      rows.push({
        name: "Příjmy",
        value: stats.revenue,
        fill: "hsl(var(--secondary))",
      });
    }
    return rows;
  }, [stats.revenue, stats.costs]);

  if (profile && !canAccess) {
    router.push("/portal/dashboard");
    return null;
  }

  if (isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          V profilu chybí přiřazení k organizaci. Obnovte stránku nebo se
          přihlaste znovu.
        </AlertDescription>
      </Alert>
    );
  }

  if (isJobsLoading || isFinanceLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasFlowChart = chartData.length > 0;
  const hasPie = pieData.length > 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Finanční centrum
          </h1>
          <p className="portal-page-description">
            Ekonomika vaší organizace podle zadaných dokladů.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button
            variant="outlineLight"
            className="min-h-[44px] gap-2"
            disabled
          >
            <Download className="h-4 w-4 shrink-0" /> Exportovat PDF
          </Button>
          {(role === "owner" || role === "admin") && (
            <Button className="min-h-[44px] gap-2">
              <Receipt className="h-4 w-4 shrink-0" /> Nový záznam
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="portal-section-label text-sm font-medium">
              Celkové příjmy
            </CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">
              {stats.revenue.toLocaleString("cs-CZ")} Kč
            </div>
            <p className="portal-kpi-label">
              {stats.revenue === 0
                ? "Zatím nemáte žádné příjmové záznamy"
                : "Součet příjmů z modulu financí"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="portal-section-label text-sm font-medium">
              Celkové výdaje
            </CardTitle>
            <Receipt className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">
              {stats.costs.toLocaleString("cs-CZ")} Kč
            </div>
            <p className="portal-kpi-label">Z výdajových dokladů</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="portal-section-label text-sm font-medium">
              Čistý výsledek
            </CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value text-emerald-700">
              {stats.profit.toLocaleString("cs-CZ")} Kč
            </div>
            <p className="portal-kpi-label">Příjmy mínus výdaje</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="portal-section-label text-sm font-medium">
              Zakázky
            </CardTitle>
            <BarChartIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">{stats.activeJobs}</div>
            <p className="portal-kpi-label">Aktivní projekty</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Vývoj cashflow</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {hasFlowChart && isMounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    stroke="#475569"
                    fontSize={12}
                    tick={{ fill: "#475569" }}
                  />
                  <YAxis
                    stroke="#475569"
                    fontSize={12}
                    tick={{ fill: "#475569" }}
                    tickFormatter={(v) => `${v / 1000}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      color: "#0f172a",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Příjmy"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                  />
                  <Line
                    type="monotone"
                    dataKey="costs"
                    name="Výdaje"
                    stroke="#f43f5e"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center text-sm text-muted-foreground">
                {isMounted
                  ? "Zatím nejsou dostupná žádná data."
                  : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Struktura příjmů a výdajů</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {hasPie && isMounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {pieData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      color: "#0f172a",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center text-sm text-muted-foreground">
                {isMounted
                  ? "Zatím nejsou dostupná žádná data."
                  : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Poslední transakce</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {financeRecords && financeRecords.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 hover:bg-transparent">
                  <TableHead className="font-medium text-slate-600">
                    Popis
                  </TableHead>
                  <TableHead className="font-medium text-slate-600">
                    Datum
                  </TableHead>
                  <TableHead className="text-right font-medium text-slate-600">
                    Částka
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(financeRecords as { id?: string }[]).map((r) => (
                  <TableRow
                    key={r.id}
                    className="border-slate-200 hover:bg-slate-50"
                  >
                    <TableCell className="font-medium text-slate-900">
                      {(r as { description?: string }).description}
                    </TableCell>
                    <TableCell className="text-slate-700">
                      {String((r as { date?: unknown }).date ?? "—")}
                    </TableCell>
                    <TableCell
                      className={`text-right font-bold tabular-nums ${
                        (r as { type?: string }).type === "revenue"
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}
                    >
                      {(r as { type?: string }).type === "revenue" ? "+" : "-"}
                      {Number(
                        (r as { amount?: unknown }).amount
                      )?.toLocaleString("cs-CZ")}{" "}
                      Kč
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-14 text-center text-sm text-muted-foreground">
              Zatím nemáte žádné transakce ve finančním modulu.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
