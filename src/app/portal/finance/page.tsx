"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Receipt, 
  Download, 
  Loader2,
  BarChart as BarChartIcon
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit } from 'firebase/firestore';
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
  Legend
} from 'recharts';
import { useRouter } from 'next/navigation';

export default function FinancePage() {
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';
  const role = profile?.role || 'employee';

  const canAccess = ['owner', 'admin', 'accountant'].includes(role);

  const jobsQuery = useMemoFirebase(() => companyId ? collection(firestore, 'companies', companyId, 'jobs') : null, [firestore, companyId]);
  const financeQuery = useMemoFirebase(() => companyId ? query(collection(firestore, 'companies', companyId, 'finance'), orderBy('date', 'desc'), limit(50)) : null, [firestore, companyId]);

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } = useCollection(financeQuery);

  const stats = useMemo(() => {
    if (!financeRecords) return { revenue: 0, costs: 0, profit: 0, activeJobs: 0 };

    const revenue = financeRecords.filter(r => r.type === 'revenue').reduce((sum, r) => sum + Number(r.amount), 0);
    const costs = financeRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + Number(r.amount), 0);
    const profit = revenue - costs;

    return {
      revenue,
      costs,
      profit,
      activeJobs: jobs?.filter(j => j.status !== 'dokončená' && j.status !== 'fakturována').length || 0
    };
  }, [financeRecords, jobs]);

  const chartData = [
    { name: 'Leden', revenue: 45000, costs: 32000 },
    { name: 'Únor', revenue: 52000, costs: 35000 },
    { name: 'Březen', revenue: 48000, costs: 31000 },
    { name: 'Duben', revenue: 61000, costs: 42000 },
    { name: 'Květen', revenue: stats.revenue || 55000, costs: stats.costs || 38000 },
  ];

  const pieData = [
    { name: 'Provozní náklady', value: stats.costs || 400, fill: 'hsl(var(--primary))' },
    { name: 'Ostatní', value: 8000, fill: 'hsl(var(--secondary))' },
  ];

  if (profile && !canAccess) {
    router.push('/portal/dashboard');
    return null;
  }

  if (isJobsLoading || isFinanceLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
        <div className="min-w-0">
          <h1 className="portal-page-title text-2xl sm:text-3xl">Finanční centrum</h1>
          <p className="portal-page-description">Ekonomika vaší organizace v reálném čase.</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <Button variant="outlineLight" className="gap-2 min-h-[44px]"><Download className="w-4 h-4 shrink-0" /> Exportovat PDF</Button>
          {(role === 'owner' || role === 'admin') && (
            <Button className="gap-2 min-h-[44px]"><Receipt className="w-4 h-4 shrink-0" /> Nový záznam</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium portal-section-label">Celkové příjmy</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">{stats.revenue.toLocaleString()} Kč</div>
            <p className="portal-kpi-label text-emerald-600 font-medium flex items-center gap-1"><TrendingUp className="w-3 h-3" /> +12%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium portal-section-label">Celkové výdaje</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">{stats.costs.toLocaleString()} Kč</div>
            <p className="portal-kpi-label">Z dokladů a mezd</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium portal-section-label">Čistý zisk</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value text-emerald-700">{stats.profit.toLocaleString()} Kč</div>
            <p className="portal-kpi-label text-emerald-600 font-medium">Marže v pořádku</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium portal-section-label">Zakázky</CardTitle>
            <BarChartIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="portal-kpi-value">{stats.activeJobs}</div>
            <p className="portal-kpi-label">Aktivní projekty</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Vývoj cashflow</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isMounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} />
                  <YAxis stroke="#475569" fontSize={12} tick={{ fill: '#475569' }} tickFormatter={(v) => `${v/1000}k`} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="revenue" name="Příjmy" stroke="hsl(var(--primary))" strokeWidth={3} />
                  <Line type="monotone" dataKey="costs" name="Výdaje" stroke="#f43f5e" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Struktura nákladů</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isMounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value">
                    {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Poslední transakce</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow className="border-slate-200 hover:bg-transparent"><TableHead className="text-slate-600 font-medium">Popis</TableHead><TableHead className="text-slate-600 font-medium">Datum</TableHead><TableHead className="text-right text-slate-600 font-medium">Částka</TableHead></TableRow></TableHeader>
            <TableBody>
              {financeRecords?.map((r) => (
                <TableRow key={r.id} className="border-slate-200 hover:bg-slate-50">
                  <TableCell className="font-medium text-slate-900">{r.description}</TableCell>
                  <TableCell className="text-slate-700">{r.date}</TableCell>
                  <TableCell className={`text-right font-bold tabular-nums ${r.type === 'revenue' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {r.type === 'revenue' ? '+' : '-'}{r.amount?.toLocaleString()} Kč
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
