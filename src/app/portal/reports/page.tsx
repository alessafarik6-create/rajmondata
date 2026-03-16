"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { 
  Download, 
  FileSpreadsheet, 
  FileText, 
  Loader2, 
  TrendingUp, 
  Users, 
  Briefcase, 
  CheckCircle2,
  Wallet,
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

export default function ReportsPage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';

  const jobsQuery = useMemoFirebase(() => companyId ? collection(firestore, 'companies', companyId, 'jobs') : null, [firestore, companyId]);
  const employeesQuery = useMemoFirebase(() => companyId ? collection(firestore, 'companies', companyId, 'employees') : null, [firestore, companyId]);
  const financeQuery = useMemoFirebase(() => companyId ? query(collection(firestore, 'companies', companyId, 'finance'), orderBy('date', 'desc')) : null, [firestore, companyId]);

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: employees } = useCollection(employeesQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } = useCollection(financeQuery);

  const monthlyRevenueData = [
    { name: 'Leden', revenue: 42000, costs: 31000 },
    { name: 'Únor', revenue: 55000, costs: 34000 },
    { name: 'Březen', revenue: 48000, costs: 32000 },
    { name: 'Duben', revenue: 61000, costs: 45000 },
    { name: 'Květen', revenue: 58000, costs: 39000 },
    { name: 'Červen', revenue: 72000, costs: 41000 },
  ];

  const jobProfitabilityData = useMemo(() => {
    if (!jobs || jobs.length === 0) return [
      { name: 'Projekt Alpha', profit: 12000, margin: 25 },
      { name: 'Web Dev', profit: 8000, margin: 15 },
      { name: 'Marketing', profit: 15000, margin: 30 },
    ];
    return jobs.slice(0, 5).map(j => ({
      name: j.name,
      profit: j.budget ? j.budget * 0.3 : 5000,
      margin: 30
    }));
  }, [jobs]);

  const employeeProductivityData = useMemo(() => {
    if (!employees || employees.length === 0) return [
      { name: 'Petr N.', hours: 168 },
      { name: 'Jana S.', hours: 152 },
      { name: 'Marek T.', hours: 175 },
    ];
    return employees.map(e => ({
      name: `${e.firstName} ${e.lastName[0]}.`,
      hours: Math.floor(Math.random() * 40) + 140
    }));
  }, [employees]);

  const handleExport = (format: 'pdf' | 'csv') => {
    setIsExporting(true);
    setTimeout(() => {
      setIsExporting(false);
      toast({
        title: "Export úspěšný",
        description: `Váš report byl vygenerován ve formátu ${format.toUpperCase()}.`,
      });
    }, 1500);
  };

  if (isJobsLoading || isFinanceLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start md:items-center">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Analytika a Reporty</h1>
          <p className="portal-page-description">Komplexní pohled na výkonnost organizace {companyId}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlineLight" className="gap-2" onClick={() => handleExport('csv')}>
            <FileSpreadsheet className="w-4 h-4" /> CSV
          </Button>
          <Button className="gap-2" onClick={() => handleExport('pdf')}>
            <FileText className="w-4 h-4" /> PDF Report
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-white border border-slate-200 mb-6 shadow-sm rounded-lg">
          <TabsTrigger value="overview" className="gap-2 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-600"><TrendingUp className="w-4 h-4" /> Přehled</TabsTrigger>
          <TabsTrigger value="employees" className="gap-2 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-600"><Users className="w-4 h-4" /> Zaměstnanci</TabsTrigger>
          <TabsTrigger value="jobs" className="gap-2 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-600"><Briefcase className="w-4 h-4" /> Zakázky</TabsTrigger>
          <TabsTrigger value="financials" className="gap-2 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-600"><Wallet className="w-4 h-4" /> Finance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">Celkové příjmy (YTD)</CardTitle></CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">1 284 500 Kč</div>
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1 font-medium"><TrendingUp className="w-3 h-3" /> +8.4% oproti minulému roku</p>
              </CardContent>
            </Card>
            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">Průměrná marže</CardTitle></CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">24.2%</div>
                <p className="text-xs text-slate-600 mt-1">Cíl: 25.0%</p>
              </CardContent>
            </Card>
            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-600">Produktivita týmu</CardTitle></CardHeader>
              <CardContent>
                <div className="portal-kpi-value text-2xl">92%</div>
                <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1 font-medium"><CheckCircle2 className="w-3 h-3" /> V normě</p>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Měsíční příjmy a náklady</CardTitle>
              <CardDescription className="text-slate-600">Srovnání finančních toků za poslední půlrok</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyRevenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} />
                    <YAxis stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} tickFormatter={(v) => `${v/1000}k`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a' }}
                      cursor={{ fill: '#f1f5f9', opacity: 0.5 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="revenue" name="Příjmy" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="costs" name="Náklady" fill="#64748b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees" className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Odpracované hodiny</CardTitle>
                <CardDescription className="text-slate-600">Srovnání výkonu jednotlivých zaměstnanců za měsíc</CardDescription>
              </CardHeader>
              <CardContent className="h-[350px]">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={employeeProductivityData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis type="number" stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} />
                      <YAxis dataKey="name" type="category" stroke="#475569" fontSize={12} width={80} tick={{ fill: '#475569' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }} />
                      <Bar dataKey="hours" name="Hodin" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Distribuce rolí</CardTitle>
                <CardDescription className="text-slate-600">Složení vašeho týmu</CardDescription>
              </CardHeader>
              <CardContent className="h-[350px] flex items-center justify-center">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Admin', value: 2 },
                          { name: 'Manager', value: 3 },
                          { name: 'Employee', value: 12 },
                          { name: 'Accountant', value: 1 },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="hsl(var(--primary))" />
                        <Cell fill="hsl(var(--secondary))" />
                        <Cell fill="#64748b" />
                        <Cell fill="#fb923c" />
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-8">
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-slate-900">Ziskovost zakázek</CardTitle>
              <CardDescription className="text-slate-600">Analýza profitu u klíčových projektů</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={jobProfitabilityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} />
                    <YAxis stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Line type="monotone" dataKey="profit" name="Zisk (Kč)" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 6 }} activeDot={{ r: 8 }} />
                    <Line type="monotone" dataKey="margin" name="Marže (%)" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financials" className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Struktura nákladů</CardTitle>
                <CardDescription className="text-slate-600">Kam plynou firemní finance</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                {isMounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Mzdy', value: 65 },
                          { name: 'Materiál', value: 20 },
                          { name: 'Provoz', value: 10 },
                          { name: 'Marketing', value: 5 },
                        ]}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                      >
                        <Cell fill="hsl(var(--primary))" />
                        <Cell fill="#ef4444" />
                        <Cell fill="#3b82f6" />
                        <Cell fill="#a855f7" />
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#0f172a' }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
                )}
              </CardContent>
            </Card>

            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-slate-900">Rychlé statistiky</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-sm text-slate-600">Průměrná hodnota zakázky</span>
                  <span className="font-bold text-slate-900 tabular-nums">84 200 Kč</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-sm text-slate-600">Náklady na 1 odpracovanou hodinu</span>
                  <span className="font-bold text-slate-900 tabular-nums">542 Kč</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-sm text-slate-600">Počet nevyfakturovaných zakázek</span>
                  <span className="font-bold text-rose-700 tabular-nums">4</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-sm text-slate-600">Očekávané příjmy (příští měsíc)</span>
                  <span className="font-bold text-emerald-700 tabular-nums">210 000 Kč</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
