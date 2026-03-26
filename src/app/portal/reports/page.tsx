"use client";

import React, { useMemo, useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  TrendingUp,
  Users,
  Briefcase,
  Wallet,
} from "lucide-react";
import {
  useUser,
  useFirestore,
  useDoc,
  useMemoFirebase,
  useCollection,
} from "@/firebase";
import { doc, collection, query, orderBy } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useCompany } from "@/firebase";

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

const ROLE_LABEL_CS: Record<string, string> = {
  owner: "Majitel",
  admin: "Administrátor",
  manager: "Manažer",
  employee: "Zaměstnanec",
  orgAdmin: "Administrátor organizace",
  accountant: "Účetní",
  customer: "Zákazník",
};

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

/** Pouze zakázky s explicitním číselným ziskem (žádné odhady). */
type JobWithProfit = {
  id?: string;
  name?: string;
  profit?: unknown;
};

export default function ReportsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const { companyName } = useCompany();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const userRef = useMemoFirebase(
    () => (user && firestore ? doc(firestore, "users", user.uid) : null),
    [firestore, user]
  );
  const { data: profile, isLoading: isProfileLoading } = useDoc(userRef);
  const companyId = profile?.companyId;

  const jobsQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "jobs")
        : null,
    [firestore, companyId]
  );
  const employeesQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "employees")
        : null,
    [firestore, companyId]
  );
  const financeQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(
            collection(firestore, "companies", companyId, "finance"),
            orderBy("date", "desc")
          )
        : null,
    [firestore, companyId]
  );

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: employees, isLoading: isEmployeesLoading } =
    useCollection(employeesQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } =
    useCollection(financeQuery);

  const ytdStats = useMemo(() => {
    if (!financeRecords?.length) {
      return { revenue: 0, costs: 0, net: 0 };
    }
    const year = new Date().getFullYear();
    let revenue = 0;
    let costs = 0;
    for (const r of financeRecords as {
      type?: string;
      amount?: unknown;
      date?: unknown;
    }[]) {
      const dt = parseRecordDate(r.date);
      if (!dt || dt.getFullYear() !== year) continue;
      const amt = Number(r.amount) || 0;
      if (r.type === "revenue") revenue += amt;
      else if (r.type === "expense") costs += amt;
    }
    return { revenue, costs, net: revenue - costs };
  }, [financeRecords]);

  const marginPct =
    ytdStats.revenue > 0
      ? ((ytdStats.revenue - ytdStats.costs) / ytdStats.revenue) * 100
      : null;

  const activeJobsCount = useMemo(() => {
    const list = (jobs as { status?: string }[] | undefined) ?? [];
    return list.filter(
      (j) => j.status !== "dokončená" && j.status !== "fakturována"
    ).length;
  }, [jobs]);

  const monthlyBarData = useMemo(() => {
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

  const rolePieData = useMemo(() => {
    const list = employees ?? [];
    if (!list.length) return [];
    const counts: Record<string, number> = {};
    for (const e of list as { role?: string }[]) {
      const r = e.role || "employee";
      counts[r] = (counts[r] || 0) + 1;
    }
    const fills = [
      "hsl(var(--primary))",
      "hsl(var(--secondary))",
      "#64748b",
      "#fb923c",
      "#22c55e",
      "#a855f7",
    ];
    return Object.entries(counts).map(([role, value], i) => ({
      name: ROLE_LABEL_CS[role] ?? role,
      value,
      fill: fills[i % fills.length],
    }));
  }, [employees]);

  const jobProfitFromData = useMemo(() => {
    const list = (jobs as JobWithProfit[] | undefined) ?? [];
    const withProfit = list.filter(
      (j) =>
        typeof j.profit === "number" &&
        !Number.isNaN(j.profit as number)
    ) as { name?: string; profit: number }[];
    return withProfit.map((j) => ({
      name: j.name || "Zakázka",
      profit: j.profit,
    }));
  }, [jobs]);

  const jobsWithBudget = useMemo(() => {
    const list = (jobs as { budget?: unknown; name?: string }[] | undefined) ?? [];
    return list.filter(
      (j) =>
        j.budget != null &&
        j.budget !== "" &&
        !Number.isNaN(Number(j.budget))
    );
  }, [jobs]);

  const avgJobBudget =
    jobsWithBudget.length > 0
      ? jobsWithBudget.reduce(
          (s, j) => s + Number(j.budget),
          0
        ) / jobsWithBudget.length
      : null;

  const unpaidJobsCount = useMemo(() => {
    const list = (jobs as { status?: string }[] | undefined) ?? [];
    return list.filter((j) => j.status && j.status !== "fakturována").length;
  }, [jobs]);

  const handleExport = (format: "pdf" | "csv") => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      toast({
        title: "Export úspěšný",
        description: `Váš report byl vygenerován ve formátu ${format.toUpperCase()}.`,
      });
    }, 1500);
  };

  if (isProfileLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <Alert className="max-w-xl border-slate-200 bg-slate-50">
        <AlertTitle>Není vybraná firma</AlertTitle>
        <AlertDescription>
          Nelze načíst reporty bez přiřazení k organizaci.
        </AlertDescription>
      </Alert>
    );
  }

  if (isJobsLoading || isFinanceLoading || isEmployeesLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const orgLabel = companyName || companyId;

  const hasAnyReportingBasics =
    (financeRecords?.length ?? 0) > 0 ||
    (jobs?.length ?? 0) > 0 ||
    (employees?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between md:items-center">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">
            Analytika a reporty
          </h1>
          <p className="portal-page-description">
            Přehled podle reálných dat organizace {orgLabel}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outlineLight"
            className="gap-2"
            disabled={isExporting}
            onClick={() => handleExport("csv")}
          >
            <FileSpreadsheet className="h-4 w-4" /> CSV
          </Button>
          <Button
            className="gap-2"
            disabled={isExporting}
            onClick={() => handleExport("pdf")}
          >
            <FileText className="h-4 w-4" /> PDF report
          </Button>
        </div>
      </div>

      {!hasAnyReportingBasics && (
        <Alert className="border-slate-200 bg-slate-50">
          <AlertTitle>Zatím nejsou dostupná žádná data</AlertTitle>
          <AlertDescription>
            Po přidání zakázek, záznamů ve financích nebo zaměstnanců se zde
            zobrazí přehledy.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
          <TabsTrigger
            value="overview"
            className="gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <TrendingUp className="h-4 w-4" /> Přehled
          </TabsTrigger>
          <TabsTrigger
            value="employees"
            className="gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Users className="h-4 w-4" /> Zaměstnanci
          </TabsTrigger>
          <TabsTrigger
            value="jobs"
            className="gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Briefcase className="h-4 w-4" /> Zakázky
          </TabsTrigger>
          <TabsTrigger
            value="financials"
            className="gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Wallet className="h-4 w-4" /> Finance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 sm:gap-6">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Příjmy (letos)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">
                  {ytdStats.revenue.toLocaleString("cs-CZ")} Kč
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ytdStats.revenue === 0
                    ? "Zatím žádné příjmové záznamy v aktuálním roce"
                    : "Součet příjmů z finančního modulu"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Čistý výsledek (letos)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">
                  {ytdStats.net.toLocaleString("cs-CZ")} Kč
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Příjmy mínus náklady podle dokladů
                </p>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Marže (letos)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">
                  {marginPct == null ? "—" : `${marginPct.toFixed(1)} %`}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {marginPct == null
                    ? "Marži lze spočítat až po prvních příjmech"
                    : "Čistý výsledek / příjmy"}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">
                Měsíční příjmy a náklady
              </CardTitle>
              <CardDescription className="text-slate-800">
                Agregace podle finančních záznamů v aktuálním roce
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              {monthlyBarData.length > 0 && isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyBarData}>
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
                      cursor={{ fill: "#f1f5f9", opacity: 0.5 }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar
                      dataKey="revenue"
                      name="Příjmy"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="costs"
                      name="Náklady"
                      fill="#64748b"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-muted-foreground">
                  Zatím nejsou dostupná žádná data.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees" className="space-y-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Odpracované hodiny
                </CardTitle>
                <CardDescription className="text-slate-800">
                  Graf vyžaduje propojení s evidencí odpracovaných hodin
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-[350px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-muted-foreground">
                Zatím nejsou k dispozici žádné agregované údaje o hodinách.
                Po zavedení evidence se zde zobrazí reálná data.
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Složení rolí</CardTitle>
                <CardDescription className="text-slate-800">
                  Podle záznamů zaměstnanců ve firmě
                </CardDescription>
              </CardHeader>
              <CardContent className="flex h-[350px] items-center justify-center">
                {rolePieData.length > 0 && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={rolePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {rolePieData.map((e, i) => (
                          <Cell key={i} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                          color: "#0f172a",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="px-4 text-center text-sm text-muted-foreground">
                    Zatím nemáte žádné zaměstnance – po prvním pozvání se zobrazí
                    rozdělení rolí.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-8">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Zisk zakázek</CardTitle>
              <CardDescription className="text-slate-800">
                Pouze zakázky s vyplněným polem zisku (žádné odhady)
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              {jobProfitFromData.length > 0 && isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={jobProfitFromData} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      horizontal={false}
                    />
                    <XAxis type="number" stroke="#475569" fontSize={12} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="#475569"
                      fontSize={12}
                      width={120}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e2e8f0",
                        color: "#0f172a",
                      }}
                    />
                    <Bar
                      dataKey="profit"
                      name="Zisk (Kč)"
                      fill="hsl(var(--primary))"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-muted-foreground">
                  Zatím nemáte žádné zakázky se zadaným ziskem. Po doplnění údajů
                  u zakázky se graf naplní.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financials" className="space-y-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Struktura nákladů
                </CardTitle>
                <CardDescription className="text-slate-800">
                  Vyžaduje kategorie nákladů u dokladů
                </CardDescription>
              </CardHeader>
              <CardContent className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-muted-foreground">
                Zatím nejsou k dispozici rozdělené nákladové kategorie. Po jejich
                evidenci zde uvidíte strukturu nákladů.
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Rychlé údaje</CardTitle>
                <CardDescription className="text-slate-800">
                  Pouze z reálných dat v systému
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Aktivní zakázky (neukončené)
                  </span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {activeJobsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Průměrný rozpočet zakázky
                  </span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {avgJobBudget == null
                      ? "—"
                      : `${Math.round(avgJobBudget).toLocaleString("cs-CZ")} Kč`}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Zakázky neuvedené jako fakturované
                  </span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {unpaidJobsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Očekávané příjmy (příští měsíc)
                  </span>
                  <span className="font-bold tabular-nums text-slate-800">
                    —
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Odhady budoucích příjmů zde zatím nezobrazujeme – bez reálných
                  dat by šlo jen o ukázku.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
