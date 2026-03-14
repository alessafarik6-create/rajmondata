
"use client";

import React, { useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Receipt, 
  Download, 
  Loader2,
  PieChart as PieChartIcon,
  BarChart as BarChartIcon,
  Lock
} from 'lucide-react';
import { useUser, useFirestore, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { doc, collection, query, orderBy, limit } from 'firebase/firestore';
import { 
  Bar, 
  BarChart, 
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

  const userRef = useMemoFirebase(() => user ? doc(firestore, 'users', user.uid) : null, [firestore, user]);
  const { data: profile } = useDoc(userRef);
  const companyId = profile?.companyId || 'nebula-tech';
  const role = profile?.role || 'employee';

  const canAccess = ['owner', 'admin', 'accountant'].includes(role);

  const jobsQuery = useMemoFirebase(() => companyId ? collection(firestore, 'companies', companyId, 'jobs') : null, [firestore, companyId]);
  const financeQuery = useMemoFirebase(() => companyId ? query(collection(firestore, 'companies', companyId, 'finance'), orderBy('date', 'desc'), limit(50)) : null, [firestore, companyId]);

  const { data: jobs, isLoading: isJobsLoading } = useCollection(jobsQuery);
  const { data: financeRecords, isLoading: isFinanceLoading } = useCollection(financeQuery);

  useEffect(() => {
    if (profile && !canAccess) {
      router.push('/portal/dashboard');
    }
  }, [profile, canAccess, router]);

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

  if (!canAccess && profile) return null;

  if (isJobsLoading || isFinanceLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold">Finanční centrum</h1>
          <p className="text-muted-foreground mt-2">Ekonomika vaší organizace v reálném čase.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="gap-2"><Download className="w-4 h-4" /> Exportovat PDF</Button>
          {(role === 'owner' || role === 'admin') && (
            <Button className="gap-2 shadow-lg shadow-primary/20"><Receipt className="w-4 h-4" /> Nový záznam</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Celkové příjmy</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.revenue.toLocaleString()} Kč</div>
            <p className="text-xs text-emerald-500 mt-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> +12%</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Celkové výdaje</CardTitle>
            <TrendingDown className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.costs.toLocaleString()} Kč</div>
            <p className="text-xs text-muted-foreground mt-1">Z dokladů a mezd</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Čistý zisk</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{stats.profit.toLocaleString()} Kč</div>
            <p className="text-xs text-emerald-500 mt-1">Marže v pořádku</p>
          </CardContent>
        </Card>
        <Card className="bg-surface border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Zakázky</CardTitle>
            <BarChartIcon className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeJobs}</div>
            <p className="text-xs text-muted-foreground mt-1">Aktivní projekty</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Vývoj cashflow</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `${v/1000}k`} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--surface))', border: '1px solid hsl(var(--border))' }} />
                <Legend />
                <Line type="monotone" dataKey="revenue" name="Příjmy" stroke="hsl(var(--primary))" strokeWidth={3} />
                <Line type="monotone" dataKey="costs" name="Výdaje" stroke="hsl(var(--rose-500))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Struktura nákladů</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value">
                  {pieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--surface))' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-surface border-border">
        <CardHeader><CardTitle>Poslední transakce</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow className="border-border"><TableHead>Popis</TableHead><TableHead>Datum</TableHead><TableHead className="text-right">Částka</TableHead></TableRow></TableHeader>
            <TableBody>
              {financeRecords?.map((r) => (
                <TableRow key={r.id} className="border-border hover:bg-muted/30">
                  <TableCell className="font-medium">{r.description}</TableCell>
                  <TableCell>{r.date}</TableCell>
                  <TableCell className={`text-right font-bold ${r.type === 'revenue' ? 'text-emerald-500' : 'text-rose-500'}`}>
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
