
"use client";

import React from 'react';
import { 
  Building2, 
  Users, 
  ShieldCheck, 
  TrendingUp, 
  CreditCard,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function AdminDashboard() {
  const stats = [
    { title: 'Total Companies', value: '1,284', icon: Building2, change: '+12%', positive: true },
    { title: 'Active Licenses', value: '45,201', icon: ShieldCheck, change: '+5%', positive: true },
    { title: 'Monthly Revenue', value: '$284,500', icon: CreditCard, change: '+18%', positive: true },
    { title: 'Active Users', value: '124.5k', icon: Users, change: '-2%', positive: false },
  ];

  const recentCompanies = [
    { id: '1', name: 'Nebula Tech', owner: 'Alex Rivera', plan: 'Enterprise', status: 'active', rev: '$2,400' },
    { id: '2', name: 'Zest Marketing', owner: 'Sarah Chen', plan: 'Professional', status: 'active', rev: '$1,200' },
    { id: '3', name: 'Iron Forge Mfg', owner: 'Tom Hardy', plan: 'Starter', status: 'pending', rev: '$450' },
    { id: '4', name: 'Vertex Solutions', owner: 'Elena Popa', plan: 'Enterprise', status: 'suspended', rev: '$0' },
    { id: '5', name: 'Swift Logistics', owner: 'James Bond', plan: 'Professional', status: 'active', rev: '$1,200' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground mt-2">Welcome back, Super Admin. Here's what's happening across the platform.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-surface border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className={`flex items-center text-xs mt-1 ${stat.positive ? 'text-emerald-500' : 'text-rose-500'}`}>
                {stat.positive ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
                {stat.change} from last month
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 bg-surface border-border">
          <CardHeader>
            <CardTitle>Recent Companies</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Company</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Monthly Rev</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentCompanies.map((company) => (
                  <TableRow key={company.id} className="border-border/50 hover:bg-muted/30">
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>{company.owner}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/50 text-primary">
                        {company.plan}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={company.status === 'active' ? 'default' : company.status === 'suspended' ? 'destructive' : 'secondary'}
                        className="capitalize"
                      >
                        {company.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{company.rev}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="bg-surface border-border">
          <CardHeader>
            <CardTitle>Revenue by Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Enterprise</span>
                <span className="font-bold">$184,200</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary w-[65%]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Professional</span>
                <span className="font-bold">$82,400</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary w-[29%]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Starter</span>
                <span className="font-bold">$17,900</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary w-[6%]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
