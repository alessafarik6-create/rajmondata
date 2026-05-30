"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
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
  useCompany,
} from "@/firebase";
import { doc, collection, query, orderBy, limit } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  computeOrganizationReports,
  formatReportCurrency,
  type ReportTab,
} from "@/lib/organization-reports";
import {
  exportOrganizationReportCsv,
  exportOrganizationReportPdf,
} from "@/lib/organization-reports-export";
import type { AttendanceRow } from "@/lib/employee-attendance";

function EmptyChartPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function KpiCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-900">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="portal-kpi-value text-2xl">{value}</div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
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
  const documentsQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? collection(firestore, "companies", companyId, "documents")
        : null,
    [firestore, companyId]
  );
  const attendanceQuery = useMemoFirebase(
    () =>
      firestore && companyId
        ? query(
            collection(firestore, "companies", companyId, "attendance"),
            orderBy("timestamp", "desc"),
            limit(5000)
          )
        : null,
    [firestore, companyId]
  );

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: employees, isLoading: isEmployeesLoading } =
    useCollection(employeesQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } =
    useCollection(financeQuery);
  const { data: documents, isLoading: isDocumentsLoading } =
    useCollection(documentsQuery);
  const { data: attendanceRows, isLoading: isAttendanceLoading } =
    useCollection(attendanceQuery);

  const reportData = useMemo(
    () =>
      computeOrganizationReports({
        financeRecords: financeRecords ?? [],
        documents: documents ?? [],
        jobs: jobs ?? [],
        employees: employees ?? [],
        attendanceRows: (attendanceRows ?? []) as AttendanceRow[],
      }),
    [financeRecords, documents, jobs, employees, attendanceRows]
  );

  const orgLabel = companyName || companyId || "organizace";

  const handleExport = useCallback(
    async (format: "pdf" | "csv") => {
      if (!reportData.hasAnyData) {
        toast({
          title: "Export nelze vytvořit",
          description: "Pro tuto organizaci zatím nejsou žádná data k exportu.",
          variant: "destructive",
        });
        return;
      }
      setIsExporting(true);
      try {
        if (format === "csv") {
          exportOrganizationReportCsv({
            tab: activeTab,
            data: reportData,
            companyName: orgLabel,
          });
        } else {
          await exportOrganizationReportPdf({
            tab: activeTab,
            data: reportData,
            companyName: orgLabel,
          });
        }
        toast({
          title: "Export úspěšný",
          description: `Report záložky byla stažen ve formátu ${format.toUpperCase()}.`,
        });
      } catch (err) {
        toast({
          title: "Export se nezdařil",
          description:
            err instanceof Error ? err.message : "Zkuste to prosím znovu.",
          variant: "destructive",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [activeTab, orgLabel, reportData, toast]
  );

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

  if (
    isJobsLoading ||
    isFinanceLoading ||
    isEmployeesLoading ||
    isDocumentsLoading ||
    isAttendanceLoading
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const { overview, employees: empReport, jobs: jobsReport, financials } =
    reportData;

  return (
    <div className="mx-auto w-full max-w-7xl min-w-0 space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between md:items-center">
        <div className="min-w-0">
          <h1 className="portal-page-title text-xl sm:text-2xl md:text-3xl break-words">
            Analytika a reporty
          </h1>
          <p className="portal-page-description">
            Přehled podle reálných dat organizace {orgLabel} (rok{" "}
            {reportData.year}).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outlineLight"
            className="min-h-[44px] gap-2"
            disabled={isExporting || !reportData.hasAnyData}
            onClick={() => void handleExport("csv")}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
            )}
            CSV
          </Button>
          <Button
            className="min-h-[44px] gap-2"
            disabled={isExporting || !reportData.hasAnyData}
            onClick={() => void handleExport("pdf")}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 shrink-0" />
            )}
            PDF report
          </Button>
        </div>
      </div>

      {!reportData.hasAnyData && (
        <Alert className="border-slate-200 bg-slate-50">
          <AlertTitle>Zatím nejsou dostupná žádná data</AlertTitle>
          <AlertDescription>
            Po přidání zakázek, finančních záznamů, dokladů, zaměstnanců nebo
            docházky se zde zobrazí přehledy. Grafy a exporty se nezobrazí, dokud
            nebudou k dispozici reálná data.
          </AlertDescription>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ReportTab)}
        className="w-full"
      >
        <TabsList className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <TabsTrigger
            value="overview"
            className="min-h-[44px] gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <TrendingUp className="h-4 w-4 shrink-0" /> Přehled
          </TabsTrigger>
          <TabsTrigger
            value="employees"
            className="min-h-[44px] gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Users className="h-4 w-4 shrink-0" /> Zaměstnanci
          </TabsTrigger>
          <TabsTrigger
            value="jobs"
            className="min-h-[44px] gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Briefcase className="h-4 w-4 shrink-0" /> Zakázky
          </TabsTrigger>
          <TabsTrigger
            value="financials"
            className="min-h-[44px] gap-2 text-slate-800 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
          >
            <Wallet className="h-4 w-4 shrink-0" /> Finance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
            <KpiCard
              title="Příjmy (letos)"
              value={formatReportCurrency(overview.ytdRevenue)}
              hint={
                overview.ytdRevenue === 0
                  ? "Z finančního modulu a dokladů v aktuálním roce"
                  : "Součet příjmů z finančních záznamů"
              }
            />
            <KpiCard
              title="Náklady (letos)"
              value={formatReportCurrency(overview.ytdCosts)}
              hint="Součet nákladových záznamů v aktuálním roce"
            />
            <KpiCard
              title="Zisk (letos)"
              value={formatReportCurrency(overview.ytdProfit)}
              hint="Příjmy mínus náklady"
            />
            <KpiCard
              title="Marže (letos)"
              value={
                overview.marginPct == null
                  ? "—"
                  : `${overview.marginPct.toFixed(1)} %`
              }
              hint={
                overview.marginPct == null
                  ? "Marži lze spočítat až po prvních příjmech"
                  : "Zisk / příjmy"
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
            <KpiCard
              title="Aktivní zakázky"
              value={String(overview.activeJobsCount)}
            />
            <KpiCard
              title="Dokončené zakázky"
              value={String(overview.completedJobsCount)}
            />
            <KpiCard
              title="Nefakturované zakázky"
              value={String(overview.unfacturedJobsCount)}
              hint="Stav „Dokončená“ — čeká na fakturaci"
            />
            <KpiCard
              title="Průměrný rozpočet"
              value={
                overview.avgJobBudget == null
                  ? "—"
                  : formatReportCurrency(overview.avgJobBudget)
              }
            />
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">
                Měsíční příjmy a náklady
              </CardTitle>
              <CardDescription className="text-slate-800">
                Agregace finančních záznamů v roce {reportData.year}
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[min(400px,60vh)] min-h-[280px]">
              {overview.hasMonthlyChart && isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview.monthlyBarData}>
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
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatReportCurrency(v)}
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
                <EmptyChartPanel message="Zatím nejsou finanční záznamy v aktuálním roce — graf se nezobrazí." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <KpiCard
              title="Zaměstnanci"
              value={String(empReport.totalCount)}
            />
            <KpiCard
              title="Odpracované hodiny (letos)"
              value={`${empReport.totalHoursYtd.toLocaleString("cs-CZ")} h`}
              hint="Součet z evidence docházky v aktuálním roce"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Odpracované hodiny po měsících
                </CardTitle>
                <CardDescription className="text-slate-800">
                  Data z docházky organizace {orgLabel}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[min(350px,55vh)] min-h-[280px]">
                {empReport.hasHoursChart && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={empReport.hoursByMonth}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        vertical={false}
                      />
                      <XAxis dataKey="name" stroke="#475569" fontSize={12} />
                      <YAxis stroke="#475569" fontSize={12} />
                      <Tooltip
                        formatter={(v: number) => `${v} h`}
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                        }}
                      />
                      <Bar
                        dataKey="hours"
                        name="Hodiny"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPanel message="Zatím nejsou zaznamenané odpracované hodiny v aktuálním roce." />
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Složení rolí</CardTitle>
                <CardDescription className="text-slate-800">
                  Podle záznamů zaměstnanců ve firmě
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[min(350px,55vh)] min-h-[280px]">
                {empReport.hasRoleChart && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={empReport.rolePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {empReport.rolePieData.map((e, i) => (
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
                  <EmptyChartPanel message="Zatím nemáte žádné zaměstnance — po prvním pozvání se zobrazí rozdělení rolí." />
                )}
              </CardContent>
            </Card>
          </div>

          {empReport.hoursByEmployee.length > 0 && (
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Hodiny podle zaměstnance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {empReport.hoursByEmployee.map((row) => (
                  <div
                    key={row.employeeId}
                    className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.role}</p>
                    </div>
                    <span className="font-bold tabular-nums text-slate-900">
                      {row.hours.toLocaleString("cs-CZ")} h
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
            <KpiCard
              title="Aktivní zakázky"
              value={String(jobsReport.activeCount)}
              hint="Neukončené a nefakturované"
            />
            <KpiCard
              title="Dokončené zakázky"
              value={String(jobsReport.completedCount)}
              hint="Stav dokončená nebo fakturována"
            />
            <KpiCard
              title="Nefakturované"
              value={String(jobsReport.unfacturedCount)}
              hint="Dokončené, ale ještě nefakturované"
            />
            <KpiCard
              title="Průměrný rozpočet"
              value={
                jobsReport.avgBudget == null
                  ? "—"
                  : formatReportCurrency(jobsReport.avgBudget)
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Přehled stavů zakázek
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[min(350px,55vh)] min-h-[280px]">
                {jobsReport.hasStatusBreakdown && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={jobsReport.statusBreakdown}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e2e8f0"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        stroke="#475569"
                        fontSize={11}
                        interval={0}
                        angle={-25}
                        textAnchor="end"
                        height={70}
                      />
                      <YAxis stroke="#475569" fontSize={12} allowDecimals={false} />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        name="Počet"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPanel message="Zatím nemáte žádné zakázky v této organizaci." />
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Zisk zakázek</CardTitle>
                <CardDescription className="text-slate-800">
                  Pouze zakázky s vyplněným polem zisku
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[min(350px,55vh)] min-h-[280px]">
                {jobsReport.hasProfitChart && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={jobsReport.jobProfitChart} layout="vertical">
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
                        fontSize={11}
                        width={100}
                      />
                      <Tooltip
                        formatter={(v: number) => formatReportCurrency(v)}
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                        }}
                      />
                      <Bar
                        dataKey="profit"
                        name="Zisk"
                        fill="hsl(var(--primary))"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPanel message="Zatím nemáte zakázky se zadaným ziskem — graf se nezobrazí." />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="financials" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
            <KpiCard
              title="Příjmy (letos)"
              value={formatReportCurrency(financials.ytdRevenue)}
            />
            <KpiCard
              title="Náklady (letos)"
              value={formatReportCurrency(financials.ytdCosts)}
            />
            <KpiCard
              title="Zisk (letos)"
              value={formatReportCurrency(financials.ytdProfit)}
            />
            <KpiCard
              title="Marže (letos)"
              value={
                financials.marginPct == null
                  ? "—"
                  : `${financials.marginPct.toFixed(1)} %`
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">
                  Struktura nákladů
                </CardTitle>
                <CardDescription className="text-slate-800">
                  Přijaté doklady podle kategorie v roce {reportData.year}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[min(300px,50vh)] min-h-[260px]">
                {financials.hasExpenseChart && isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={financials.expenseStructure}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {financials.expenseStructure.map((e, i) => (
                          <Cell key={i} fill={e.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => formatReportCurrency(v)}
                        contentStyle={{
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChartPanel message="Zatím nejsou přijaté doklady s náklady v aktuálním roce — graf se nezobrazí." />
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Rychlé údaje</CardTitle>
                <CardDescription className="text-slate-800">
                  Zakázky organizace {orgLabel}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">Aktivní zakázky</span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {financials.activeJobsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">Dokončené zakázky</span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {financials.completedJobsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Nefakturované zakázky
                  </span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {financials.unfacturedJobsCount}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <span className="text-sm text-slate-800">
                    Průměrný rozpočet zakázky
                  </span>
                  <span className="font-bold tabular-nums text-slate-900">
                    {financials.avgJobBudget == null
                      ? "—"
                      : formatReportCurrency(financials.avgJobBudget)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">
                Měsíční příjmy a náklady
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[min(350px,55vh)] min-h-[280px]">
              {financials.hasMonthlyChart && isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={financials.monthlyBarData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      vertical={false}
                    />
                    <XAxis dataKey="name" stroke="#475569" fontSize={12} />
                    <YAxis
                      stroke="#475569"
                      fontSize={12}
                      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatReportCurrency(v)}
                      contentStyle={{
                        backgroundColor: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "8px",
                      }}
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
                <EmptyChartPanel message="Zatím nejsou finanční záznamy v aktuálním roce." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
